import {syncMigratedDatasetLifecycle} from "../persistence/migrated-dataset-lifecycle.ts";
import { projectCommentPersons } from "../comments/retained-person-repository.ts";
import type { PageRevisionSelection } from "./page-revision-contracts.ts";
import {
  resolvePageRevision,
  readOnlyPagePermissions,
  pageRevisionQuery,
} from "./page-revision.ts";
import { syncRetainedPathChange } from "../retained-folders/locations.ts";
/**
 * Pages over the v2 HTTP API (src/server/af-api-contracts.ts): publish, read,
 * save, paths and the hosted representations. Every page edit goes through the
 * page model's prepareForSave; every linked backend file through brief C's port.
 */
import { createPageWriteRepository } from "../persistence/page-writes.ts";
import {
  KNOWN_AF_ORIGINS,
  MAX_PAGE_SOURCE,
  MAX_BACKEND_SOURCE_CHARACTERS,
  utf8ByteLength,
  type AfJsonObject,
  type FileId,
} from "../af-contracts.ts";
import type {
  DeleteResponse,
  PublishResponse,
  SaveResponse,
  SourceResponse,
} from "./af-api-contracts.ts";
import type { PageModelModule, PreparedPage } from "../page/page-contracts.ts";
import type { BackendFilesPort } from "../backend/af-backend-contracts.ts";
import type { CompiledBackend } from "../backend/contracts.ts";
import type {
  FilePermissions,
  PathChange,
  PathEntry,
  ShareRole,
  Visibility,
} from "../contracts.ts";
import type { SessionGrant } from "../identity-data-contracts.ts";
import type { IdentityAuthority } from "./identity-contracts.ts";
import type { SqlDatabase } from "../persistence/sql.ts";
import type { DocumentHeader } from "./document-authorization-contracts.ts";
import { fileAddress, isFileId } from "../ids/file-id.ts";
import { readFileId, type RandomBytes } from "./af-ids.ts";
import {
  loadDocumentHeader,
  loadSession,
  lockDocumentHeader,
} from "../persistence/document-records.ts";
import { pathLock, readPaths, writeFolders } from "../persistence/paths.js";
import { namespaceOwner } from "../group-authority.ts";
import { authorizeDocument } from "./document-authorization.ts";
import { changePaths, normalizePath } from "../path-model.ts";
import { permissions } from "../access.ts";
import { canonical } from "../model-values.ts";
import { fail } from "../errors.ts";
import { hash } from "./text.ts";
import { pageProblem, sourceDigest } from "./page-ports.ts";
import { hostedDesignSystem } from "./af-hosting.ts";

const MAX_SOURCE = MAX_PAGE_SOURCE;

export interface PageServiceOptions {
  historicalDatasetReplay?: import("../datasets/history-contracts.ts").HistoricalDatasetReplay;
  database: SqlDatabase;
  authority: Pick<IdentityAuthority, "account" | "issue">;
  pageModel(): Promise<PageModelModule>;
  /** Brief C's port, or null when the backend module is not installed. */
  backendFiles(): Promise<BackendFilesPort | null>;
  writes?: import("./page-write-contracts.ts").PageWriteRepository;
  randomBytes: RandomBytes;
  /** Origins rewritten to this server on save, besides KNOWN_AF_ORIGINS (the skill's default host and the earlier ones). */
  knownOrigins?: readonly string[];
  now?: () => number;
  token(): string;
}

/** `If-Match: 3`, `"3"` or `W/"3"`; null when absent. */
export function parseIfMatch(value: string | undefined): number | null {
  if (value === undefined || !value.trim()) return null;
  const bare = value
    .trim()
    .replace(/^W\//, "")
    .replace(/^"(.*)"$/, "$1");
  return /^[1-9][0-9]{0,9}$/.test(bare) ? Number(bare) : NaN;
}
function source(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || utf8ByteLength(value) > MAX_SOURCE)
    fail(422, `source must be the page's HTML (at most ${MAX_SOURCE.toLocaleString('en-US')} UTF-8 bytes, including saved metadata)`);
  return value;
}
function backendSources(value: unknown): Record<FileId, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    fail(422, "files must map file IDs to file contents");
  const files: Record<FileId, string> = {};
  let size = 0;
  for (const [id, content] of Object.entries(value)) {
    if (!isFileId(id))
      fail(422, `files: ${JSON.stringify(id)} is not a file ID`);
    if (typeof content !== "string" || !content.trim())
      fail(422, `files: ${id} must be the file's contents`);
    size += content.length;
    files[id] = content;
  }
  if (size > MAX_BACKEND_SOURCE_CHARACTERS) fail(413, "files are too large");
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
  writes: providedWrites,
  historicalDatasetReplay,
}: PageServiceOptions) {
  const writes =
    providedWrites ??
    createPageWriteRepository({
      database,
      account: (session) => authority.account(session),
      backendFiles,
      randomBytes,
      token,
      now,
    });
  const writeCredential = (credential: string) => ({
    sessionHash: hash(credential),
    shareHash: credential ? hash(credential) : null,
  });
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
      const prepared=model.prepareForSave(html, context);
      source(prepared.source);
      return prepared;
    } catch (error) {
      pageProblem(error);
    }
  }
  /** Compile the whole batch outside any transaction; the port's limits apply to it and a failure names its file. */
  async function compile(
    port: import("./page-write-contracts.ts").PageBackendPreparation,
    signal?: AbortSignal,
  ): Promise<Record<FileId, CompiledBackend>> {
    try {
      return await port.compile(signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const { status, code, fileId, detail } = error as {
        status?: unknown;
        code?: unknown;
        fileId?: unknown;
        detail?: unknown;
      };
      if (typeof status === "number" && status >= 500) throw error;
      const id = typeof fileId === "string" ? fileId : null;
      if (code === "backend_unavailable" || code === "backend_busy")
        return fail(
          503,
          `files: ${id ?? "the backend files"} could not be compiled now; try again later`,
        );
      // The publisher owns the file: what it said while loading (bounded by the host) may be shown.
      const message =
        (error instanceof Error ? error.message : "invalid backend file") +
        (typeof detail === "string" ? `: ${detail}` : "");
      if (id === null) return fail(422, `files: ${message}`);
      return fail(
        422,
        `files: ${id} could not be compiled: ${message.startsWith(id + ": ") ? message.slice(id.length + 2) : message}`,
      );
    }
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
        fail(
          422,
          "requestId must be a string you choose (at most 200 characters)",
        );
      if (
        input.visibility !== undefined &&
        !visibilities.includes(input.visibility as Visibility)
      )
        fail(422, "visibility must be private, unlisted or public");
      if (
        input.linkRole !== undefined &&
        !roles.includes(input.linkRole as ShareRole)
      )
        fail(422, "linkRole must be viewer, commenter or editor");
      const requestedPath =
        input.path === undefined || input.path === null
          ? null
          : normalizePath(input.path);
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
      const first = await writes.inspectPublication({
        credential: writeCredential(credential),
        requestId,
        fingerprint,
      });
      if (first.replayed)
        return {
          status: 200,
          value: {
            ...first.replayed,
            url: fileAddress(origin, first.replayed.id),
            path: apiPath(first.replayed.path),
          },
        };
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
      const backends = await writes.preflightBackends({
        actor,
        links: draft.backends,
        files,
      });
      const compiled = backends ? await compile(backends, signal) : {};
      const result = await writes.commitPublication({
        credential: writeCredential(credential),
        actor,
        requestId,
        fingerprint,
        requestedId: requested,
        requestedPath,
        folder,
        visibility: (input.visibility as Visibility | undefined) ?? "unlisted",
        linkRole: (input.linkRole as ShareRole | undefined) ?? "viewer",
        backends,
        compiled,
        prepareForId: (id) => prepare(model, html, context(id)),
      });
      return {
        status: result.kind === "created" ? 201 : 200,
        value: {
          ...result.page,
          url: fileAddress(origin, result.page.id),
          path: apiPath(result.page.path),
        },
      };
    },

    readSource(
      credential: string,
      id: string,
      selection: PageRevisionSelection = { kind: "head" },
    ): Promise<SourceResponse> {
      if (!isFileId(id)) fail(404, "File not found");
      return database.transaction(async (client) => {
        const session = await loadSession(client, hash(credential));
        const document = owned(await loadDocumentHeader(client, id));
        access(document, session, credential, id);
        const selected = resolvePageRevision(selection, document.head);
        const row = (
          await client.query(
            "SELECT content FROM sources WHERE file_id=$1 AND revision=$2",
            [id, String(selected.version)],
          )
        ).rows[0];
        if (!row) fail(404, "Source unavailable");
        return { source: String(row.content), version: selected.version };
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
        canonical([
          "save",
          html,
          Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)),
        ]),
      );
      const first = await writes.inspectSave({
        credential: writeCredential(credential),
        id,
        expected,
        key,
        fingerprint,
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
      if (
        base.ownerKind === "group" &&
        (prepared.backends.length || Object.keys(files).length)
      )
        fail(422, "Group-owned pages do not support backend files");
      const backends = await writes.preflightBackends({
        actor: base.actor,
        links: prepared.backends,
        files,
      });
      const compiled = backends ? await compile(backends, signal) : {};
      return writes.commitSave({
        credential: writeCredential(credential),
        id,
        base,
        prepared,
        backends,
        compiled,
        key,
        fingerprint,
      });
    },

    /** Move a managed page to recoverable trash, retaining every version and ID. */
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
        await client.query("UPDATE files SET deleted_at=$2,trash_path=path,generation=generation+1 WHERE id=$1", [id, now()]);
        await syncMigratedDatasetLifecycle(client,document.owner,[id]);
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
        await syncRetainedPathChange(client, owner, change);
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
    address(
      credential: string,
      id: string,
      selection: PageRevisionSelection = { kind: "head" },
    ): Promise<AddressedFile> {
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
          if (selection.kind === "saved")
            fail(404, "Saved page version not found");
          const port = await backendFiles();
          const head = port ? await port.head(client, id) : null;
          if (!head || actor === null || head.owner !== actor)
            fail(404, "Not found");
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
        const selected = resolvePageRevision(selection, document.head);
        const row = (
          await client.query(
            "SELECT s.content,f.seed FROM sources s JOIN files f ON f.id=s.file_id WHERE s.file_id=$1 AND s.revision=$2",
            [id, String(selected.version)],
          )
        ).rows[0];
        if (!row) fail(404, "Saved page version not found");
        return {
          kind: "page" as const,
          page: {
            id,
            version: selected.version,
            revision: selected.historical
              ? sourceDigest(String(row.content))
              : (document.sourceDigest ?? sourceDigest(String(row.content))),
            path: document.path ?? id,
            source: String(row.content),
            state: selected.historical
              ? null
              : ((row.seed as AfJsonObject | null) ?? null),
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
     * reads (including source), comments, presence and backend calls for that
     * page under the account's current permission. No source edits, sharing
     * management, account access or access to another page. 401 without an account session, 403 when the
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
    async host(
      credential: string,
      id: string,
      origin: string,
      issueSession = true,
      selection: PageRevisionSelection = { kind: "head" },
    ) {
      if (!isFileId(id)) fail(404, "Document not found");
      const hosted = await database.transaction(async (client) => {
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
          fail(
            actor ? 403 : 401,
            "You need an invitation to open this document.",
          );
        const selected = resolvePageRevision(selection, document.head);
        const row = (
          await client.query(
            "SELECT s.content,f.seed FROM sources s JOIN files f ON f.id=s.file_id WHERE s.file_id=$1 AND s.revision=$2",
            [id, String(selected.version)],
          )
        ).rows[0];
        if (!row) fail(404, "Saved page version not found");
        const issued =
          actor && issueSession && !granted && !selected.historical
            ? authority.issue(actor, id, document.generation)
            : null;
        // A "document" grant: same-page reads (including source), comments,
        // presence and backend calls under current permission; no account
        // access, source edits, sharing management or other-page permission.
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
        const version = selected.version;
        const source = String(row.content);
        const digest = selected.historical
          ? sourceDigest(source)
          : (document.sourceDigest ?? sourceDigest(source));
        const comments = await projectCommentPersons(client,id,(
          await client.query(
            `SELECT id,node_id AS "nodeId",quote,body,source_revision AS "sourceRevision",parent_id AS "parentId",app_state_id AS "appStateId",published_by AS "publishedBy",created_at AS "createdAt",revision,resolved,fingerprint,sequence::int AS sequence FROM comments WHERE file_id=$1 ORDER BY sequence DESC LIMIT 50`,
            [id],
          )
        ).rows
          .reverse()
          // The runtime keys the open version by its digest (see src/browser/comment-wire.ts).
          .map((c) =>
            c.sourceRevision === String(version)
              ? { ...c, sourceRevision: digest }
              : c,
          ).map(c=>({...c,id:String(c.id),body:String(c.body),publishedBy:String(c.publishedBy)})));
        const people = [
          ...new Set([
            document.owner,
            ...(actor ? [actor] : []),
            ...comments.map((c) => String(c.publishedBy)),
          ]),
        ];
        const profiles = Object.fromEntries(
          (
            await client.query(
              "SELECT actor,name,image FROM accounts WHERE actor=ANY($1::text[])",
              [people],
            )
          ).rows.map((r) => [
            String(r.actor),
            {
              name: String(r.name || r.actor),
              image: r.image ? String(r.image) : null,
            },
          ]),
        );
        return {
          source,
          version,
          designSystem: await hostedDesignSystem(await pageModel(), source),
          /** The hosted runtime's document state (src/browser/document-session.js reads it). */
          state: {
            format: 1,
            ...(selected.historical ? { contextOnly: true } : {}),
            fileId: id,
            sourceRevision: digest,
            // A read capability for link viewers, never an account credential.
            remote: selected.historical
              ? null
              : { origin, share: document.share, head: digest },
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
          seed: selected.historical
            ? null
            : ((row.seed as AfJsonObject | null) ?? null),
          boot: {
            fileId: id,
            version,
            url: fileAddress(origin, id) + pageRevisionQuery(selection),
            token: issued?.credential ?? null,
            permissions: selected.historical
              ? readOnlyPagePermissions(grant)
              : grant,
            username: actor,
            home: origin,
            path: apiPath(document.path ?? id),
          },
        };
      });
      if (selection.kind !== "saved" || !issueSession || !historicalDatasetReplay)
        return hosted;
      const rendered = await historicalDatasetReplay.render(
        id, hosted.version, hosted.boot.username,
      );
      if (!rendered) return hosted;
      return {
        ...hosted,
        state: {
          ...hosted.state,
          app: {schema: 0, sourceRevision: hosted.state.sourceRevision,
            state: {}, view: {x: 0, y: 0}, rendered},
        },
      };
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
