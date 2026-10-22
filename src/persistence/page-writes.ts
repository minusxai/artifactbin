/** Atomic page writes. Compilation is returned as a capability and never runs in a transaction. */
import type {
  PageWriteRepository,
  PageBackendPreparation,
  PublishedPage,
  PageSaveResult,
} from "../server/page-write-contracts.ts";
import type { SqlClient, SqlDatabase } from "./sql-contracts.ts";
import type { BackendFilesPort } from "../backend/af-backend-contracts.ts";
import type { FileId } from "../af-contracts.ts";
import type { PreparedPage } from "../page/page-contracts.ts";
import type { SessionGrant } from "../identity-data-contracts.ts";
import type { DocumentHeader } from "../server/document-authorization-contracts.ts";
import type { RandomBytes } from "../server/af-ids.ts";
import {
  claimReservedId,
  insertFreshId,
  readFileId,
} from "../server/af-ids.ts";
import {
  loadSession,
  loadDocumentHeader,
  lockDocumentHeader,
} from "./document-records.ts";
import { checkIdempotency, recordIdempotency } from "./idempotency.ts";
import { pathLock, readPaths, writeFolders } from "./paths.js";
import { authorizeDocument } from "../server/document-authorization.ts";
import { defaultPath, addDocument } from "../path-model.ts";
import { documentTitle, hash } from "../server/text.ts";
import { sourceDigest } from "../server/page-ports.ts";
import { fail } from "../errors.ts";
import type { AccessPolicy } from "../contracts.ts";
export interface PageWriteRepositoryOptions {
  database: SqlDatabase;
  account(session: SessionGrant | null): string;
  backendFiles(): Promise<BackendFilesPort | null>;
  randomBytes: RandomBytes;
  token(): string;
  now?: () => number;
}
async function conflict(
  client: SqlClient,
  id: string,
  version: number,
): Promise<never> {
  const row = (
    await client.query(
      "SELECT content FROM sources WHERE file_id=$1 AND revision=$2",
      [id, String(version)],
    )
  ).rows[0];
  throw Object.assign(
    new Error(
      "Someone else saved first. Merge your change into this source and save again.",
    ),
    { status: 409, details: { version, source: String(row?.content ?? "") } },
  );
}
function owned(header: DocumentHeader | null): DocumentHeader {
  return header ?? fail(404, "File not found");
}
function nextNodeId(prepared: PreparedPage): number {
  const value = prepared.meta.nextNodeId;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 1;
}
export function createPageWriteRepository({
  database,
  account,
  backendFiles,
  randomBytes,
  token,
  now = Date.now,
}: PageWriteRepositoryOptions): PageWriteRepository {
  const preparations = new WeakMap<
    PageBackendPreparation,
    {
      actor: string;
      port: BackendFilesPort;
      ids: FileId[];
      files: Readonly<Record<FileId, string>>;
    }
  >();
  function binding(preparation: PageBackendPreparation | null, actor: string) {
    if (!preparation) return null;
    const value = preparations.get(preparation);
    if (!value || value.actor !== actor)
      throw Error("Invalid page backend preparation");
    return value;
  }
  function access(
    document: DocumentHeader,
    session: SessionGrant | null,
    credentialHash: string | null,
    id: string,
  ) {
    return authorizeDocument({
      document,
      session,
      credentialHash,
      fileId: id,
      now: now(),
    });
  }
  async function checkBackends(
    client: SqlClient,
    port: BackendFilesPort,
    actor: string,
    links: readonly FileId[],
    files: Readonly<Record<FileId, string>>,
  ): Promise<{ reserved: FileId[] }> {
    const ids = Object.keys(files);
    const reserved: FileId[] = [];
    const ownedBackends = new Set(await port.owned(client, actor, ids));
    for (const id of ids) {
      if (!links.includes(id))
        fail(
          422,
          `files: ${id} is not linked from the page with an af-backend link`,
        );
      const record = await readFileId(client, id);
      if (record && record.owner === actor && !record.published)
        reserved.push(id);
      else if (!ownedBackends.has(id))
        fail(
          422,
          `files: ${id} is not a file ID you reserved or a backend file you own`,
        );
    }
    const unsent = links.filter((id) => !Object.hasOwn(files, id));
    const published = new Set(
      unsent.length ? await port.published(client, unsent) : [],
    );
    for (const id of unsent)
      if (!published.has(id))
        fail(
          422,
          `The linked backend ${id} is not published; send its contents in files`,
        );
    return { reserved };
  }

  async function publishBackendIds(
    client: SqlClient,
    actor: string,
    reserved: readonly FileId[],
  ) {
    for (const id of reserved)
      if (!(await claimReservedId(client, actor, id, "backend")))
        fail(409, `files: ${id} was published by another request`);
  }

  async function replay(
    client: SqlClient,
    actor: string,
    requestId: string,
    fingerprint: string,
  ): Promise<PublishedPage | null> {
    const row = (
      await client.query(
        "SELECT p.file_id,p.fingerprint,p.path,s.content FROM publications p JOIN sources s ON s.file_id=p.file_id AND s.revision='1' WHERE p.request_key=$1",
        [actor + ":" + requestId],
      )
    ).rows[0];
    if (!row) return null;
    if (row.fingerprint !== fingerprint)
      fail(409, "This requestId was already used for a different publish");
    const id = String(row.file_id);
    if (!(await loadDocumentHeader(client, id))) fail(404, "File not found");
    return {
      id,
      version: 1,
      path: String(row.path),
      source: String(row.content),
    };
  }

  async function replayed(
    client: SqlClient,
    id: string,
    actor: string,
    key: string | null,
    fingerprint: string,
  ): Promise<PageSaveResult | null> {
    if (key === null) return null;
    const decision = await checkIdempotency(
      client,
      { fileId: id, actor, key },
      fingerprint,
      now(),
    );
    return decision.kind === "replay"
      ? {
          status: decision.status,
          value: decision.body as PageSaveResult["value"],
          changed: false,
        }
      : null;
  }
  return {
    async inspectPublication({ credential, requestId, fingerprint }) {
      return database.transaction(async (client) => {
        const actor = account(
          await loadSession(client, credential.sessionHash),
        );
        return {
          actor,
          replayed: await replay(client, actor, requestId, fingerprint),
        };
      });
    },
    async inspectSave({ credential, id, expected, key, fingerprint }) {
      return database.transaction(async (client) => {
        const session = await loadSession(client, credential.sessionHash);
        const document = owned(await loadDocumentHeader(client, id));
        const decision = access(document, session, credential.shareHash, id);
        if (!decision.owner || !decision.actor)
          fail(403, "Only owners and editors can change the page");
        // A replay wins over If-Match: the page may have moved on since the first save.
        const replay = await replayed(
          client,
          id,
          decision.actor,
          key,
          fingerprint,
        );
        if (replay) return { replay, base: null };
        if (expected === null)
          fail(428, "Send If-Match with the version you edited");
        const version = Number(document.head);
        if (expected !== version) await conflict(client, id, version);
        const reserved = new Set<string>();
        for (const row of (
          await client.query("SELECT node_ids FROM sources WHERE file_id=$1", [
            id,
          ])
        ).rows)
          for (const nodeId of row.node_ids as string[]) reserved.add(nodeId);
        const next = (
          await client.query("SELECT next_node_id FROM files WHERE id=$1", [id])
        ).rows[0]?.next_node_id;
        return {
          replay: null,
          base: {
            actor: decision.actor,
            owner: document.owner,
            ownerKind: document.ownerKind,
            version,
            reserved,
            nextNodeId: Number(next) || 0,
          },
        };
      });
    },
    async preflightBackends({ actor, links, files }) {
      const ids = links.map(
        (link) =>
          link.id ??
          fail(
            422,
            `Line ${link.line}: the af-backend link "${link.name}" must point at /af/v1/ids/<id>`,
          ),
      );
      const port = await backendFiles();
      if (!port) {
        if (!ids.length && !Object.keys(files).length) return null;
        fail(503, "Backend files are not available on this server");
      }
      await database.transaction((client) =>
        checkBackends(client, port, actor, ids, files),
      );
      const preparation: PageBackendPreparation = {
        compile: (signal) => port.compile(files, signal),
      };
      preparations.set(preparation, { actor, port, ids, files });
      return preparation;
    },
    async commitPublication(input) {
      const {
        credential,
        actor,
        requestId,
        fingerprint,
        requestedId,
        requestedPath,
        folder,
        visibility,
        linkRole,
        compiled,
        prepareForId,
      } = input;
      const backends = binding(input.backends, actor);
      return database.transaction(async (client) => {
        if (
          account(await loadSession(client, credential.sessionHash)) !== actor
        )
          fail(401, "Sign in required");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':publication:' || $1,0))",
          [actor + ":" + requestId],
        );
        const again = await replay(client, actor, requestId, fingerprint);
        if (again) return { kind: "replayed" as const, page: again };
        // A named ID is used only when it is the caller's unpublished reservation. Anything
        // else (someone else's, already published, never reserved) is refused rather than
        // quietly publishing a copied page under a fresh ID.
        if (
          requestedId &&
          !(await claimReservedId(client, actor, requestedId, "page"))
        )
          fail(
            422,
            `The meta block names ID ${requestedId}, which is not an ID you reserved and have not published. Take "id" out of the meta block to publish this as a new page, or save the published page with PUT /api/files/${requestedId}/source.`,
          );
        const id =
          requestedId ??
          (await insertFreshId(client, randomBytes, {
            owner: actor,
            reservationKey: null,
            ordinal: null,
            kind: "page",
            now: now(),
          }));
        const prepared = prepareForId(id);
        const reserved = backends
          ? await checkBackends(
              client,
              backends.port,
              actor,
              backends.ids,
              backends.files,
            )
          : { reserved: [] };
        await pathLock(client, actor);
        const entries = await readPaths(client, actor);
        const path =
          requestedPath ??
          defaultPath(
            typeof prepared.meta.name === "string" && prepared.meta.name.trim()
              ? prepared.meta.name
              : documentTitle(prepared.source),
            entries,
            folder,
          );
        const next = addDocument(entries, path, id);
        const share = token();
        const policy: AccessPolicy = {
          // Unlisted by default: anyone with the link can view (PublishRequest.visibility).
          visibility: visibility,
          linkRole: linkRole,
          shares: {},
          version: 1,
        };
        // The page's data-af="state" block: where each viewer's own local state starts.
        await client.query(
          "INSERT INTO files(id,owner,share_hash,generation,head,sequence,share,path,access,seed,next_node_id,source_digest) VALUES($1,$2,$3,1,'1',0,$4,$5,$6::jsonb,$7::jsonb,$8,$9)",
          [
            id,
            actor,
            hash(share),
            share,
            path,
            JSON.stringify(policy),
            prepared.state ? JSON.stringify(prepared.state) : null,
            nextNodeId(prepared),
            sourceDigest(prepared.source),
          ],
        );
        await writeFolders(client, actor, next);
        await client.query(
          "INSERT INTO sources(file_id,revision,content,node_ids,digest) VALUES($1,'1',$2,$3::jsonb,$4)",
          [
            id,
            prepared.source,
            JSON.stringify(prepared.nodeIds),
            sourceDigest(prepared.source),
          ],
        );
        if (backends) {
          await publishBackendIds(client, actor, reserved.reserved);
          await backends.port.record(client, {
            owner: actor,
            pageId: id,
            pageVersion: 1,
            links: prepared.backends,
            compiled,
          });
        }
        await client.query(
          "INSERT INTO publications(request_key,file_id,fingerprint,path) VALUES($1,$2,$3,$4)",
          [actor + ":" + requestId, id, fingerprint, path],
        );
        return {
          kind: "created" as const,
          page: {
            id,
            version: 1,
            path,
            source: prepared.source,
          },
        };
      });
    },
    async commitSave(input) {
      const { credential, id, base, prepared, compiled, key, fingerprint } =
        input;
      const version = base.version + 1;
      const backends = binding(input.backends, base.actor);
      return database.transaction(async (client) => {
        const session = await loadSession(client, credential.sessionHash);
        const document = owned(await lockDocumentHeader(client, id));
        const decision = access(document, session, credential.shareHash, id);
        if (!decision.owner || decision.actor !== base.actor)
          fail(403, "Only owners and editors can change the page");
        // The header lock serializes requests sharing a key; look again under it.
        const replay = await replayed(client, id, base.actor, key, fingerprint);
        if (replay) return replay;
        if (Number(document.head) !== base.version)
          await conflict(client, id, Number(document.head));
        const reserved = backends
          ? await checkBackends(
              client,
              backends.port,
              base.actor,
              backends.ids,
              backends.files,
            )
          : { reserved: [] };
        await client.query(
          "INSERT INTO sources(file_id,revision,content,node_ids,digest) VALUES($1,$2,$3,$4::jsonb,$5)",
          [
            id,
            String(version),
            prepared.source,
            JSON.stringify(prepared.nodeIds),
            sourceDigest(prepared.source),
          ],
        );
        // The seed is the page's, not the version's: a save keeps it unless it carries a new data-af="state" block.
        await client.query(
          "UPDATE files SET head=$2,next_node_id=GREATEST(next_node_id,$3),source_digest=$4,seed=COALESCE($5::jsonb,seed) WHERE id=$1",
          [
            id,
            String(version),
            nextNodeId(prepared),
            sourceDigest(prepared.source),
            prepared.state ? JSON.stringify(prepared.state) : null,
          ],
        );
        if (backends) {
          await publishBackendIds(client, base.actor, reserved.reserved);
          await backends.port.record(client, {
            owner: base.actor,
            pageId: id,
            pageVersion: version,
            links: prepared.backends,
            compiled,
          });
        }
        const saved: PageSaveResult["value"] = {
          version,
          source: prepared.source,
        };
        if (key !== null)
          await recordIdempotency(
            client,
            { fileId: id, actor: base.actor, key },
            fingerprint,
            { status: 200, body: saved },
            now(),
          );
        return { status: 200, value: saved, changed: true };
      });
    },
  };
}
