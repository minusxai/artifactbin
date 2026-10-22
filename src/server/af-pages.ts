/**
 * Pages over the v2 HTTP API (src/server/af-api-contracts.ts): publish, read,
 * save, paths and the hosted representations. Every page edit goes through the
 * page model's prepareForSave; every linked backend file through brief C's port.
 */
import {
  KNOWN_AF_ORIGINS,
  MAX_PAGE_SOURCE,
  type AfJsonObject,
  type FileId,
} from "../af-contracts.ts";
import type {
  DeleteResponse,
  PublishResponse,
  SaveResponse,
  SourceResponse,
} from "./af-api-contracts.ts";
import type {
  BackendLink,
  PageModelModule,
  PreparedPage,
} from "../page/page-contracts.ts";
import type { BackendFilesPort } from "../backend/af-backend-contracts.ts";
import type { CompiledBackend } from "../backend/contracts.ts";
import type {
  AccessPolicy,
  FilePermissions,
  PathChange,
  PathEntry,
  ShareRole,
  Visibility,
} from "../contracts.ts";
import type { SessionGrant } from "../identity-data-contracts.ts";
import type { IdentityAuthority } from "./identity-contracts.ts";
import type { SqlClient, SqlDatabase } from "../persistence/sql.ts";
import type { DocumentHeader } from "./document-authorization-contracts.ts";
import { fileAddress, isFileId } from "../ids/file-id.ts";
import {
  claimReservedId,
  insertFreshId,
  readFileId,
  type RandomBytes,
} from "./af-ids.ts";
import {
  loadDocumentHeader,
  loadSession,
  lockDocumentHeader,
} from "../persistence/document-records.ts";
import { pathLock, readPaths, writeFolders } from "../persistence/paths.js";
import { checkIdempotency, recordIdempotency } from "../persistence/idempotency.ts";
import { namespaceOwner } from "../group-authority.ts";
import { authorizeDocument } from "./document-authorization.ts";
import { addDocument, changePaths, defaultPath, normalizePath } from "../path-model.ts";
import { permissions } from "../access.ts";
import { canonical } from "../model-values.ts";
import { fail } from "../errors.ts";
import { documentTitle, hash } from "./text.ts";
import { pageProblem, sourceDigest } from "./page-ports.ts";
import { hostedDesignSystem } from "./af-hosting.ts";

const MAX_SOURCE = MAX_PAGE_SOURCE;

export interface PageServiceOptions {
  database: SqlDatabase;
  authority: Pick<IdentityAuthority, "account" | "issue">;
  pageModel(): Promise<PageModelModule>;
  /** Brief C's port, or null when the backend module is not installed. */
  backendFiles(): Promise<BackendFilesPort | null>;
  randomBytes: RandomBytes;
  /** Origins rewritten to this server on save, besides KNOWN_AF_ORIGINS (the skill's default host and the earlier ones). */
  knownOrigins?: readonly string[];
  now?: () => number;
  token(): string;
}

/** 409 with the head's version and source (SaveConflict), so a client can merge without another request. */
async function conflict(client: SqlClient, id: string, version: number): Promise<never> {
  const row = (
    await client.query("SELECT content FROM sources WHERE file_id=$1 AND revision=$2", [id, String(version)])
  ).rows[0];
  throw Object.assign(
    new Error("Someone else saved first. Merge your change into this source and save again."),
    { status: 409, details: { version, source: String(row?.content ?? "") } },
  );
}
/** `If-Match: 3`, `"3"` or `W/"3"`; null when absent. */
export function parseIfMatch(value: string | undefined): number | null {
  if (value === undefined || !value.trim()) return null;
  const bare = value.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
  return /^[1-9][0-9]{0,9}$/.test(bare) ? Number(bare) : NaN;
}
function source(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_SOURCE)
    fail(422, "source must be the page's HTML (at most 4,000,000 characters)");
  return value;
}
function backendSources(value: unknown): Record<FileId, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    fail(422, "files must map file IDs to file contents");
  const files: Record<FileId, string> = {};
  let size = 0;
  for (const [id, content] of Object.entries(value)) {
    if (!isFileId(id)) fail(422, `files: ${JSON.stringify(id)} is not a file ID`);
    if (typeof content !== "string" || !content.trim())
      fail(422, `files: ${id} must be the file's contents`);
    size += content.length;
    files[id] = content;
  }
  if (size > MAX_SOURCE) fail(413, "files are too large");
  return files;
}
const visibilities: Visibility[] = ["private", "unlisted", "public"];
const roles: ShareRole[] = ["viewer", "commenter", "editor"];
/** Paths are shown without the leading slash the catalog stores. */
const apiPath = (path: string) => path.replace(/^\//, "");

function owned(header: DocumentHeader | null): DocumentHeader {
  return header ?? fail(404, "File not found");
}

export function createPageService({
  database,
  authority,
  pageModel,
  backendFiles,
  randomBytes,
  knownOrigins = [],
  now = Date.now,
  token,
}: PageServiceOptions) {
  const rewritten = [...new Set([...KNOWN_AF_ORIGINS, ...knownOrigins])];
  const credentialHash = (credential: string) =>
    credential ? hash(credential) : null;

  function account(session: SessionGrant | null): string {
    return authority.account(session);
  }
  function access(
    document: DocumentHeader | null,
    session: SessionGrant | null,
    credential: string,
    id: string,
  ) {
    return authorizeDocument({
      document,
      session,
      credentialHash: credentialHash(credential),
      fileId: id,
      now: now(),
    });
  }
  function prepare(
    model: PageModelModule,
    html: string,
    context: Parameters<PageModelModule["prepareForSave"]>[1],
  ): PreparedPage {
    try {
      return model.prepareForSave(html, context);
    } catch (error) {
      pageProblem(error);
    }
  }
  function linkedIds(links: readonly BackendLink[]): FileId[] {
    return links.map(
      (link) =>
        link.id ??
        fail(
          422,
          `Line ${link.line}: the af-backend link "${link.name}" must point at /af/v1/ids/<id>`,
        ),
    );
  }

  /**
   * Publish rules for `files` and links: every file is linked and is the
   * caller's (reserved and unpublished, or an owned backend); every linked ID
   * not in `files` is already published.
   */
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
        fail(422, `files: ${id} is not linked from the page with an af-backend link`);
      const record = await readFileId(client, id);
      if (record && record.owner === actor && !record.published) reserved.push(id);
      else if (!ownedBackends.has(id))
        fail(422, `files: ${id} is not a file ID you reserved or a backend file you own`);
    }
    const unsent = links.filter((id) => !Object.hasOwn(files, id));
    const published = new Set(
      unsent.length ? await port.published(client, unsent) : [],
    );
    for (const id of unsent)
      if (!published.has(id))
        fail(422, `The linked backend ${id} is not published; send its contents in files`);
    return { reserved };
  }

  /** Compile the whole batch outside any transaction; the port's limits apply to it and a failure names its file. */
  async function compile(
    port: BackendFilesPort,
    files: Readonly<Record<FileId, string>>,
    signal?: AbortSignal,
  ): Promise<Record<FileId, CompiledBackend>> {
    try {
      return await port.compile(files, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const { status, code, fileId, detail } = error as { status?: unknown; code?: unknown; fileId?: unknown; detail?: unknown };
      if (typeof status === "number" && status >= 500) throw error;
      const id = typeof fileId === "string" ? fileId : null;
      if (code === "backend_unavailable" || code === "backend_busy")
        return fail(503, `files: ${id ?? "the backend files"} could not be compiled now; try again later`);
      // The publisher owns the file: what it said while loading (bounded by the host) may be shown.
      const message =
        (error instanceof Error ? error.message : "invalid backend file") +
        (typeof detail === "string" ? `: ${detail}` : "");
      if (id === null) return fail(422, `files: ${message}`);
      return fail(422, `files: ${id} could not be compiled: ${message.startsWith(id + ": ") ? message.slice(id.length + 2) : message}`);
    }
  }

  /** Mark the caller's reserved backend IDs published under the page that sent them. */
  async function publishBackendIds(
    client: SqlClient,
    actor: string,
    reserved: readonly FileId[],
  ) {
    for (const id of reserved)
      if (!(await claimReservedId(client, actor, id, "backend")))
        fail(409, `files: ${id} was published by another request`);
  }

  /**
   * Brief C's port takes part in every publish and save once it is installed,
   * so a save that drops every link also stops the old backends being callable.
   */
  async function backendsFor(links: readonly BackendLink[], files: Record<FileId, string>) {
    const ids = linkedIds(links);
    const port = await backendFiles();
    if (!port) {
      if (!ids.length && !Object.keys(files).length) return null;
      fail(503, "Backend files are not available on this server");
    }
    return { port, ids };
  }

  async function replay(
    client: SqlClient,
    actor: string,
    requestId: string,
    fingerprint: string,
    origin: string,
  ): Promise<PublishResponse | null> {
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
    return {
      id,
      version: 1,
      url: fileAddress(origin, id),
      path: apiPath(String(row.path)),
      source: String(row.content),
    };
  }

  return {
    async publish(
      credential: string,
      input: Record<string, unknown>,
      origin: string,
      signal?: AbortSignal,
      /** The library's own placement: with no `path`, name the page from its title in this folder. */
      placement: { folder?: unknown } = {},
    ): Promise<{ status: 200 | 201; value: PublishResponse }> {
      const html = source(input.source);
      const files = backendSources(input.files);
      const requestId = input.requestId;
      if (typeof requestId !== "string" || !requestId || requestId.length > 200)
        fail(422, "requestId must be a string you choose (at most 200 characters)");
      if (input.visibility !== undefined && !visibilities.includes(input.visibility as Visibility))
        fail(422, "visibility must be private, unlisted or public");
      if (input.linkRole !== undefined && !roles.includes(input.linkRole as ShareRole))
        fail(422, "linkRole must be viewer, commenter or editor");
      const requestedPath =
        input.path === undefined || input.path === null ? null : normalizePath(input.path);
      const folder =
        placement.folder === undefined || placement.folder === null
          ? "/"
          : normalizePath(placement.folder, true);
      const fingerprint = hash(
        canonical([
          html,
          Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)),
          requestedPath,
          (input.visibility as string | undefined) ?? null,
          (input.linkRole as string | undefined) ?? null,
          // Only a non-root folder joins, so earlier root publishes keep their fingerprints.
          ...(folder === "/" ? [] : [folder]),
        ]),
      );
      const first = await database.transaction(async (client) => {
        const actor = account(await loadSession(client, hash(credential)));
        return { actor, replayed: await replay(client, actor, requestId, fingerprint, origin) };
      });
      if (first.replayed) return { status: 200, value: first.replayed };
      const actor = first.actor;
      const model = await pageModel();
      const meta = model.parsePage(html).meta;
      const requested = isFileId(meta?.id) ? meta.id : null;
      const context = (id: FileId) => ({
        id,
        version: 1,
        origin,
        knownOrigins: rewritten,
        previousNextNodeId: 0,
        reserved: new Set<string>(),
      });
      // Validate the page before touching backends; the real ID is chosen in the write.
      const draft = prepare(model, html, context(requested ?? "AAAAAA"));
      const backends = await backendsFor(draft.backends, files);
      if (backends)
        await database.transaction((client) =>
          checkBackends(client, backends.port, actor, backends.ids, files),
        );
      const compiled = backends ? await compile(backends.port, files, signal) : {};
      return database.transaction(async (client) => {
        if (account(await loadSession(client, hash(credential))) !== actor)
          fail(401, "Sign in required");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':publication:' || $1,0))",
          [actor + ":" + requestId],
        );
        const again = await replay(client, actor, requestId, fingerprint, origin);
        if (again) return { status: 200 as const, value: again };
        // A named ID is used only when it is the caller's unpublished reservation. Anything
        // else (someone else's, already published, never reserved) is refused rather than
        // quietly publishing a copied page under a fresh ID.
        if (requested && !(await claimReservedId(client, actor, requested, "page")))
          fail(
            422,
            `The meta block names ID ${requested}, which is not an ID you reserved and have not published. Take "id" out of the meta block to publish this as a new page, or save the published page with PUT /api/files/${requested}/source.`,
          );
        const id =
          requested ??
          (await insertFreshId(client, randomBytes, {
            owner: actor,
            reservationKey: null,
            ordinal: null,
            kind: "page",
            now: now(),
          }));
        const prepared = prepare(model, html, context(id));
        const reserved = backends
          ? await checkBackends(client, backends.port, actor, backends.ids, files)
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
          visibility: (input.visibility as Visibility | undefined) ?? "unlisted",
          linkRole: (input.linkRole as ShareRole | undefined) ?? "viewer",
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
          [id, prepared.source, JSON.stringify(prepared.nodeIds), sourceDigest(prepared.source)],
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
          status: 201 as const,
          value: {
            id,
            version: 1,
            url: fileAddress(origin, id),
            path: apiPath(path),
            source: prepared.source,
          },
        };
      });
    },

    readSource(credential: string, id: string): Promise<SourceResponse> {
      if (!isFileId(id)) fail(404, "File not found");
      return database.transaction(async (client) => {
        const session = await loadSession(client, hash(credential));
        const document = owned(await loadDocumentHeader(client, id));
        access(document, session, credential, id);
        const row = (
          await client.query(
            "SELECT content FROM sources WHERE file_id=$1 AND revision=$2",
            [id, document.head],
          )
        ).rows[0];
        if (!row) fail(404, "Source unavailable");
        return { source: String(row.content), version: Number(document.head) };
      });
    },

    /**
     * PUT /api/files/:id/source. With an Idempotency-Key (`key`), the first
     * successful save's response is stored in the save's own transaction and
     * a repeat returns it (`changed: false`) instead of saving again.
     */
    async save(
      credential: string,
      id: string,
      ifMatch: string | undefined,
      input: Record<string, unknown>,
      origin: string,
      signal?: AbortSignal,
      key: string | null = null,
    ): Promise<{ status: number; value: SaveResponse; changed: boolean }> {
      if (!isFileId(id)) fail(404, "File not found");
      const html = source(input.source);
      const files = backendSources(input.files);
      const expected = parseIfMatch(ifMatch);
      const fingerprint = hash(
        canonical(["save", html, Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))]),
      );
      const replayed = async (client: SqlClient, actor: string) => {
        if (key === null) return null;
        const decision = await checkIdempotency(client, { fileId: id, actor, key }, fingerprint, now());
        return decision.kind === "replay"
          ? { status: decision.status, value: decision.body as SaveResponse, changed: false }
          : null;
      };
      const first = await database.transaction(async (client) => {
        const session = await loadSession(client, hash(credential));
        const document = owned(await loadDocumentHeader(client, id));
        const decision = access(document, session, credential, id);
        if (!decision.owner || !decision.actor)
          fail(403, "Only owners and editors can change the page");
        // A replay wins over If-Match: the page may have moved on since the first save.
        const replay = await replayed(client, decision.actor);
        if (replay) return { replay, base: null };
        if (expected === null)
          fail(428, "Send If-Match with the version you edited");
        const version = Number(document.head);
        if (expected !== version) await conflict(client, id, version);
        const reserved = new Set<string>();
        for (const row of (
          await client.query("SELECT node_ids FROM sources WHERE file_id=$1", [id])
        ).rows)
          for (const nodeId of row.node_ids as string[]) reserved.add(nodeId);
        const next = (
          await client.query("SELECT next_node_id FROM files WHERE id=$1", [id])
        ).rows[0]?.next_node_id;
        return {
          replay: null,
          base: { actor: decision.actor, owner: document.owner, ownerKind: document.ownerKind, version, reserved, nextNodeId: Number(next) || 0 },
        };
      });
      if (first.replay) return first.replay;
      const base = first.base;
      const model = await pageModel();
      const version = base.version + 1;
      const prepared = prepare(model, html, {
        id,
        version,
        origin,
        knownOrigins: rewritten,
        previousNextNodeId: base.nextNodeId,
        reserved: base.reserved,
      });
      if (base.ownerKind === "group" && (prepared.backends.length || Object.keys(files).length))
        fail(422, "Group-owned pages do not support backend files");
      const backends = await backendsFor(prepared.backends, files);
      if (backends)
        await database.transaction((client) =>
          checkBackends(client, backends.port, base.actor, backends.ids, files),
        );
      const compiled = backends ? await compile(backends.port, files, signal) : {};
      const value = await database.transaction(async (client) => {
        const session = await loadSession(client, hash(credential));
        const document = owned(await lockDocumentHeader(client, id));
        const decision = access(document, session, credential, id);
        if (!decision.owner || decision.actor !== base.actor)
          fail(403, "Only owners and editors can change the page");
        // The header lock serializes requests sharing a key; look again under it.
        const replay = await replayed(client, base.actor);
        if (replay) return replay;
        if (Number(document.head) !== base.version)
          await conflict(client, id, Number(document.head));
        const reserved = backends
          ? await checkBackends(client, backends.port, base.actor, backends.ids, files)
          : { reserved: [] };
        await client.query(
          "INSERT INTO sources(file_id,revision,content,node_ids,digest) VALUES($1,$2,$3,$4::jsonb,$5)",
          [id, String(version), prepared.source, JSON.stringify(prepared.nodeIds), sourceDigest(prepared.source)],
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
        const saved: SaveResponse = { version, source: prepared.source };
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
      return value;
    },

    /**
     * DELETE /api/files/:id: the owner removes the page, its versions,
     * comments, page state, keys, publish requestIds, document sessions and
     * file ID, which is retired so it is never handed out again. Linked
     * backend files are separate files and stay. No account token is 401;
     * anyone but the owner gets 404, so the answer reveals nothing.
     */
    remove(credential: string, id: string): Promise<DeleteResponse> {
      if (!isFileId(id)) fail(404, "File not found");
      return database.transaction(async (client) => {
        const session = await loadSession(client, hash(credential));
        const actor = account(session);
        const header = await loadDocumentHeader(client, id);
        if (!header || !permissions(header, actor, false, false, session?.groupAuthority).manage)
          fail(404, "File not found");
        await pathLock(client, header.owner);
        const document = await lockDocumentHeader(client, id);
        if (!document || !permissions(document, actor, false, false, session?.groupAuthority).manage)
          fail(404, "File not found");
        for (const statement of [
          "DELETE FROM idempotency_keys WHERE file_id=$1",
          "DELETE FROM comments WHERE file_id=$1",
          "DELETE FROM snapshots WHERE file_id=$1",
          "DELETE FROM sources WHERE file_id=$1",
          "DELETE FROM publications WHERE file_id=$1",
          "DELETE FROM sessions WHERE file_id=$1",
          "DELETE FROM files WHERE id=$1",
          "DELETE FROM file_ids WHERE id=$1",
        ])
          await client.query(statement, [id]);
        await (await backendFiles())?.forgetPage(client, id);
        await client.query(
          "INSERT INTO retired_file_ids(id,retired_at) VALUES($1,$2) ON CONFLICT (id) DO NOTHING",
          [id, now()],
        );
        return { id, deleted: true as const };
      });
    },

    async paths(credential: string, origin: string, change?: PathChange, selection: import("../group-authority-contracts.ts").OwnerNamespaceSelection = {}) {
      const entries = await database.transaction(async (client) => {
        const session = await loadSession(client, hash(credential));
        const actor = account(session);
        const owner = namespaceOwner(actor, selection.owner, !!change, session?.groupAuthority);
        if (!change) return readPaths(client, owner);
        await pathLock(client, owner);
        const before = await readPaths(client, owner),
          after = changePaths(before, change);
        for (const entry of after.filter((e) => e.fileId)) {
          const old = before.find((e) => e.fileId === entry.fileId);
          if (old?.path !== entry.path)
            await client.query("UPDATE files SET path=$3 WHERE owner=$1 AND id=$2", [
              owner,
              entry.fileId,
              entry.path,
            ]);
        }
        await client.query("DELETE FROM folders WHERE owner=$1", [owner]);
        await writeFolders(client, owner, after);
        return after;
      });
      return {
        entries: entries
          .map((entry: PathEntry) => ({
            path: apiPath(entry.path),
            fileId: entry.fileId,
            ...(entry.fileId ? { url: fileAddress(origin, entry.fileId) } : {}),
          }))
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      };
    },

    /**
     * What `/af/v1/ids/<id>` shows this caller. Unknown, reserved-but-unpublished
     * and unreadable files are all 404 so an address reveals nothing.
     */
    address(credential: string, id: string): Promise<AddressedFile> {
      if (!isFileId(id)) fail(404, "Not found");
      return database.transaction(async (client) => {
        const record = await readFileId(client, id);
        if (!record?.published) fail(404, "Not found");
        const session = await loadSession(client, hash(credential));
        let actor: string | null = null;
        try {
          actor = account(session);
        } catch {}
        if (record.kind === "backend") {
          const port = await backendFiles();
          const head = port ? await port.head(client, id) : null;
          if (!head || actor === null || head.owner !== actor) fail(404, "Not found");
          return {
            kind: "backend" as const,
            value: { id, kind: "backend" as const, version: head.version },
          };
        }
        const document = await loadDocumentHeader(client, id);
        if (!document) fail(404, "Not found");
        const grant = readable(document, actor, session);
        if (!grant)
          throw Object.assign(new Error("Not found"), {
            status: 404,
            signIn: actor === null,
          });
        const row = (
          await client.query(
            "SELECT s.content,f.seed FROM sources s JOIN files f ON f.id=s.file_id WHERE s.file_id=$1 AND s.revision=$2",
            [id, document.head],
          )
        ).rows[0]!;
        return {
          kind: "page" as const,
          page: {
            id,
            version: Number(document.head),
            revision: document.sourceDigest ?? sourceDigest(String(row.content)),
            path: document.path ?? id,
            source: String(row.content),
            state: (row.seed as AfJsonObject | null) ?? null,
          },
        };
      });
    },

    /**
     * What the approval window shows for a connection to page `id`: its path
     * when the account behind `credential` can read it, else null, so a code
     * reveals nothing about a private page; 404 unless it is a published page.
     */
    connectInfo(id: string, credential = ""): Promise<{ id: string; path: string | null }> {
      if (!isFileId(id)) fail(404, "Not found");
      return database.transaction(async (client) => {
        const record = await readFileId(client, id);
        if (!record?.published || record.kind !== "page") fail(404, "Not found");
        const document = await loadDocumentHeader(client, id);
        if (!document) fail(404, "Not found");
        const session = await loadSession(client, hash(credential));
        let actor: string | null = null;
        try {
          actor = account(session);
        } catch {}
        return { id, path: readable(document, actor, session) ? apiPath(document.path ?? id) : null };
      });
    },

    /**
     * A page grant for `id` to the account behind `credential` (a connected
     * downloaded file): the same `document` session the hosted shell gets, for
     * comments, presence and backend calls as that account, never source,
     * sharing or account access. 401 without an account session, 403 when the
     * account cannot read the page.
     */
    grant(credential: string, id: string): Promise<{ token: string; username: string }> {
      if (!isFileId(id)) fail(404, "Not found");
      return database.transaction(async (client) => {
        const session = await loadSession(client, hash(credential));
        const actor = account(session);
        const document = await lockDocumentHeader(client, id);
        if (!document) fail(404, "Not found");
        if (!readable(document, actor, session)) fail(403, "You do not have access to this page.");
        const issued = authority.issue(actor, id, document.generation);
        await client.query(
          "INSERT INTO sessions(token_hash,actor,file_id,generation,expires,purpose) VALUES($1,$2,$3,$4,$5,'document')",
          [issued.tokenHash, issued.session.actor, issued.session.fileId, issued.session.generation, issued.session.expires],
        );
        return { token: issued.credential, username: actor };
      });
    },

    /** End a document grant issued by `grant` (a connection that expired while it was issued). */
    async revoke(token: string): Promise<void> {
      await database.transaction((client) =>
        client.query("DELETE FROM sessions WHERE token_hash=$1 AND purpose='document'", [hash(token)]),
      );
    },

    /**
     * The hosted runner's representation of a page: its source (exactly the
     * saved bytes: the runtime keys the version by its digest), the page's own
     * design system's CSS to put before the core so the first paint is styled
     * without another request, the seed each viewer's local state starts from,
     * and a document-scoped session for a signed-in viewer (never an account token).
     * A viewer holding a page grant for this page (a connected downloaded
     * file) opens it as their account.
     */
    host(credential: string, id: string, origin: string, issueSession = true) {
      if (!isFileId(id)) fail(404, "Document not found");
      return database.transaction(async (client) => {
        const session = await loadSession(client, hash(credential));
        const document = await lockDocumentHeader(client, id);
        if (!document) fail(404, "Document not found");
        let actor: string | null = null;
        try {
          actor = account(session);
        } catch {}
        // A page grant for this page (a connected downloaded file) opens it as its account too.
        const granted = !actor && documentGrant(session, id, document, now());
        if (granted) actor = session!.actor;
        const grant = readable(document, actor, session);
        if (!grant)
          fail(actor ? 403 : 401, "You need an invitation to open this document.");
        const row = (
          await client.query(
            "SELECT s.content,f.seed FROM sources s JOIN files f ON f.id=s.file_id WHERE s.file_id=$1 AND s.revision=$2",
            [id, document.head],
          )
        ).rows[0]!;
        const issued =
          actor && issueSession && !granted ? authority.issue(actor, id, document.generation) : null;
        // A "document" grant: comments and presence while the account's
        // role allows them, never source, sharing or account access.
        if (issued)
          await client.query(
            "INSERT INTO sessions(token_hash,actor,file_id,generation,expires,purpose) VALUES($1,$2,$3,$4,$5,'document')",
            [
              issued.tokenHash,
              issued.session.actor,
              issued.session.fileId,
              issued.session.generation,
              issued.session.expires,
            ],
          );
        const version = Number(document.head);
        const source = String(row.content);
        const digest = document.sourceDigest ?? sourceDigest(source);
        const comments = (
          await client.query(
            `SELECT id,node_id AS "nodeId",quote,body,source_revision AS "sourceRevision",parent_id AS "parentId",app_state_id AS "appStateId",published_by AS "publishedBy",created_at AS "createdAt",revision,resolved,fingerprint,sequence::int AS sequence FROM comments WHERE file_id=$1 ORDER BY sequence DESC LIMIT 50`,
            [id],
          )
        )
          .rows.reverse()
          // The runtime keys the open version by its digest (see src/browser/comment-wire.ts).
          .map((c) => (c.sourceRevision === String(version) ? { ...c, sourceRevision: digest } : c));
        const people = [
          ...new Set([document.owner, ...(actor ? [actor] : []), ...comments.map((c) => String(c.publishedBy))]),
        ];
        const profiles = Object.fromEntries(
          (
            await client.query("SELECT actor,name,image FROM accounts WHERE actor=ANY($1::text[])", [people])
          ).rows.map((r) => [String(r.actor), { name: String(r.name || r.actor), image: r.image ? String(r.image) : null }]),
        );
        return {
          source,
          version,
          designSystem: await hostedDesignSystem(await pageModel(), source),
          /** The hosted runtime's document state (src/browser/document-session.js reads it). */
          state: {
            format: 1,
            fileId: id,
            sourceRevision: digest,
            // A read capability for link viewers, never an account credential.
            remote: { origin, share: document.share, head: digest },
            anchors: {},
            comments,
            pending: [],
            app: null,
            snapshots: {},
            sources: { [digest]: source },
            profiles,
            publishRequest: "",
          },
          /** Where each viewer's own local state starts (the published data-af="state" block). */
          seed: (row.seed as AfJsonObject | null) ?? null,
          boot: {
            fileId: id,
            version,
            url: fileAddress(origin, id),
            token: issued?.credential ?? null,
            permissions: grant,
            username: actor,
            home: origin,
            path: apiPath(document.path ?? id),
          },
        };
      });
    },
  };
}

/** Read permission for an address or hosted view; null when the caller may not see it. */
/** True when `session` is a live `document` grant for this page and its current sharing generation. */
function documentGrant(session: SessionGrant | null, id: string, document: DocumentHeader, now: number): boolean {
  return (
    !!session &&
    session.purpose === "document" &&
    session.fileId === id &&
    session.generation === document.generation &&
    session.expires > now
  );
}
function readable(document: DocumentHeader, actor: string | null, session: SessionGrant | null): FilePermissions | null {
  const grant = permissions(document, actor, true, false, session?.groupAuthority);
  return grant.read ? grant : null;
}
function nextNodeId(prepared: PreparedPage): number {
  const value = prepared.meta.nextNodeId;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 1;
}

export interface AddressedPage {
  id: FileId;
  version: number;
  /** The server's digest of `source`, what the hosted UI keys this version by. */
  revision: string;
  path: string;
  source: string;
  /** The page's seed: written into a downloaded file's data-af="state" block. */
  state: AfJsonObject | null;
}
export type AddressedFile =
  | { kind: "page"; page: AddressedPage }
  | {
      kind: "backend";
      value: { id: FileId; kind: "backend"; version: string };
    };
export type PageService = ReturnType<typeof createPageService>;
