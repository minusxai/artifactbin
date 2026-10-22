/**
 * Pagegi v2 HTTP API (owner: brief B, except the routes marked C, which brief
 * C implements behind AfRouteModule and B mounts). This is the exact surface in
 * skills/pagegi-author/references/http-api.md.
 *
 * All JSON. Errors are `{ "error": string }` with a 4xx/5xx status.
 * Credentials: `Authorization: Bearer <token>`. Page scripts never run on the
 * platform origin and never see a token.
 *
 * Route table (status codes are part of the contract):
 *   POST /api/auth/email/request   { email }                → 200 { sent: true }
 *   POST /api/auth/email/verify    { email, code }          → 200 { token, username }
 *   POST /api/auth/test-token      { email, browserSession? } → 200 { token, username }
 *                                  only when the service runs with testLogin; 404 otherwise.
 *                                  With browserSession (same-origin only) it sets the browser
 *                                  session cookie like email/verify does and returns { username }.
 *   GET  /api/auth/session         (bearer token)           → 200 { username, handle }; 401 when the token is not valid
 *                                  (handle: the account's handle or null; see ./handles-contracts.ts)
 *   POST /api/ids                  { count } + Idempotency-Key → 201 { ids } (200 on replay)
 *                                  400 no key or bad count (1..100); 401 no token; 422 key reused with another count
 *   POST /api/publish              PublishRequest           → 201 PublishResponse (200 on requestId replay)
 *                                  409 when the requestId was used for a different publish; 422 naming
 *                                  the ID when the meta block names one that is not the caller's
 *                                  unpublished reservation (never silently published under a new ID)
 *   GET  /api/files/:id/source                              → 200 SourceResponse, ETag: "<version>"
 *   PUT  /api/files/:id/source     SaveRequest + If-Match: <version> [+ Idempotency-Key] → 200 SaveResponse
 *                                  409 SaveConflict { error, version, source } when If-Match is not
 *                                  the current version; 428 when If-Match is missing
 *   DELETE /api/files/:id                                   → 200 DeleteResponse (owner only)
 *                                  401 without a valid account token; 404 for everyone else
 *   GET  /api/files/:id/comments                            → 200 CommentsResponse
 *                                  ?since=<cursor> lists only later changes; 400 when the cursor is malformed
 *   POST /api/files/:id/comments   { comment: CommentInput } [+ Idempotency-Key] → 201 CommentRecord
 *   PUT  /api/files/:id/comments/:commentId  { body?, resolved? } + If-Match: <revision> → 200 CommentRecord
 *                                  409 when the revision is stale; 428 when If-Match is missing
 *
 * Idempotency-Key (PUT …/source and POST …/comments, optional; see IDEMPOTENCY_TTL_MS):
 *   - 1..200 printable ASCII characters; anything else is 400.
 *   - Scoped to the page and the caller's account. The first successful
 *     request stores its status and body in the same transaction as its write.
 *   - The same key with the same body returns that stored status and body, even
 *     if the page or comment changed since. Failed requests store nothing.
 *   - The same key with a different body (for a save: source and files; for a
 *     comment: the comment object) is 422.
 *   - Keys expire after IDEMPOTENCY_TTL_MS; after that the key is new again.
 *   - Without the header, behaviour is unchanged.
 *   GET  /api/files/:id/context/:commentId                  → 200 ContextResponse
 *   POST /api/files/:id/capture    { sessionId } (platform UI) → 200 Capture: another viewer's current local state and view, read-only
 *   POST /api/pair, GET /api/pair/info, POST /api/pair/approve, POST /api/pair/poll, GET /connect
 *                                  (platform UI) connect a downloaded file to its page as the viewer's
 *                                  account; see src/server/af-connect-contracts.ts
 *   GET  /api/files/:id/sharing                             → 200 { policy, permissions, url, owner }
 *   PUT  /api/files/:id/sharing    AccessPatch + If-Match   → 200 sharing; 412 when If-Match is
 *                                  missing or not the policy's version (not 428/409 like the routes above)
 *   GET  /api/paths                                         → 200 { entries }
 *   POST /api/paths                PathChange (src/contracts.ts: folder, move, move-many,
 *                                  remove-folder)           → 200 { entries }; 404 unknown path,
 *                                  409 path taken, 422 invalid path or kind
 *   GET  /api/secrets                                       → 200 SecretsListResponse (names and times, never values)
 *   PUT  /api/secrets/:name        { value }                → 200 SecretWriteResponse (create or replace)
 *                                  422 bad name (SECRET_NAME), bad value (1..4096 bytes) or a 65th secret
 *   DELETE /api/secrets/:name                               → 200 SecretDeleteResponse; 404 when there is none
 *                                  All three: 401 without a valid account (bearer token, or the home
 *                                  page's cookie session); 503 "Secrets are not configured" when the
 *                                  server has no PAGEGI_SECRETS_KEY. See ./secrets-contracts.ts.
 *   GET  /api/account/handle                                → 200 { handle } (null when the account has none)
 *   PUT  /api/account/handle       { handle }               → 200 { handle }; 409 taken by another account;
 *                                  422 against the rules in ./handles-contracts.ts
 *   DELETE /api/account/handle                              → 200 { handle: null }
 *                                  All three: 401 without a valid account (bearer token, or the home
 *                                  page's cookie session).
 *
 * Without a token: the account routes (/api/ids, /api/publish, DELETE
 * /api/files/:id, /api/paths, /api/secrets, /api/account/handle) are 401; the page routes under /api/files/:id/
 * are 403 even on an unlisted page, whose hosted view (/af/v1/ids/:id) works
 * for anyone with the link. The link role applies to anonymous viewers too.
 *   GET  /api/files/:id/backends   (C)                      → 200 BackendsResponse
 *   POST /api/files/:id/graphql    (C) RemoteRequest        → 200 RemoteResponse
 *   GET  /af/v1/core.js                                     → 200 text/javascript (the built core)
 *   GET  /af/v1/design-systems/<name>.css                   → 200 text/css, byte-equal to
 *                                  skills/pagegi-author/design-systems/<name>.css; 404 for other names
 *   GET  /a/<id>                   page: 200 text/html hosted view (the page runs in the
 *                                  isolated runner frame, never on the platform origin);
 *                                  a private page without a signed-in viewer: 302 to /?next=<address>;
 *                                  reserved-but-unpublished, unknown or unreadable: 404.
 *                                  `-<anything>` after the ID (a title slug) is ignored.
 *   GET  /a/<id>?download=1        page: 200 text/html attachment from PageModelModule.toPortable, with the
 *                                  server's origin and the version's digest on the core tag and no credential
 *   GET  /@<handle>/<path>         the page at <path> in the library of the account with that handle
 *                                  (both percent-encoded), exactly as /a/<id>, with ?download=1 too;
 *                                  a renamed or missing path, an unknown or freed handle, or anything
 *                                  that is not a handle (an email address): 404
 *   GET  /af/v1/ids/<id>           any file by ID, exactly as /a/<id> for a page;
 *                                  backend: 200 { id, kind: "backend", name?, version } to its owner, else 404
 *   GET  /skills/pagegi-author.tgz                          → 200 application/gzip, cacheable: the whole
 *                                  author skill (skills/pagegi-author/) as a gzip tarball with a
 *                                  top-level pagegi-author/ directory (SkillArchive); other /skills/ paths 404
 *
 * `:id` is always a six-character file ID. The old 12-character document IDs,
 * /d/, /documents/, /f/ paths, /api/files/:id/backend/* and the shared-state
 * routes /api/files/:id/sync* are removed: local state belongs to each viewer
 * and never reaches the server.
 */
import type { AfJsonObject, FileId } from "../af-contracts.ts";
import type { ShareRole, Visibility } from "../contracts.ts";

export interface PublishRequest {
  source: string;
  /** Linked backend files by ID: `{ "Bk7Qa2": "<file contents>" }`. */
  files?: Record<FileId, string>;
  /** Client-chosen; a repeat with the same requestId returns the first result and creates nothing. */
  requestId: string;
  path?: string;
  /** Default "unlisted": anyone with the link can view. */
  visibility?: Visibility;
  /** Default "viewer". */
  linkRole?: ShareRole;
}
export interface PublishResponse {
  id: FileId;
  version: number;
  /** The page's canonical address, `${origin}/a/${id}`. */
  url: string;
  path: string;
  /** The page exactly as saved: meta block with id/version, every data-af-id, hosts rewritten. */
  source: string;
}
export interface SourceResponse {
  source: string;
  version: number;
}
export interface SaveRequest {
  source: string;
  files?: Record<FileId, string>;
}
export interface SaveResponse {
  version: number;
  source: string;
}
/** 409 body of PUT /api/files/:id/source: the current head, so a client can merge without another request. */
export interface SaveConflict {
  error: string;
  version: number;
  source: string;
}
/**
 * 200 body of DELETE /api/files/:id. The page, its versions, comments, page
 * state, idempotency keys, publish requestIds, document sessions and its file
 * ID are gone: every route for the ID then answers 404. Backend files the page
 * linked are separate files with their own IDs and stay published (other pages
 * may link them); only this page's links to them are removed.
 */
export interface DeleteResponse {
  id: FileId;
  deleted: true;
}
/** How long an Idempotency-Key and its stored response are kept. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** POST /api/files/:id/comments body: `{ comment: CommentInput }`. */
export interface CommentInput {
  /** The `data-af-id` the comment is on, or null for the whole page. */
  nodeId: string | null;
  quote: string;
  body: string;
  parentId?: string | null;
  /** Page version the commenter saw; defaults to the current version. */
  version?: number;
  /** The commenter's own local state when they commented; kept with the comment for context. */
  state?: AfJsonObject | null;
  /**
   * Platform UI only: an inert copy of what the commenter saw (scripts and
   * attributes stripped, at most 200000 characters). Agents leave it out.
   */
  rendered?: string | null;
}
export interface CommentRecord {
  context?: import("../contracts.ts").CommentContextStatus;
  id: string;
  nodeId: string | null;
  quote: string;
  body: string;
  parentId: string | null;
  version: number | null;
  author: string;
  createdAt: string;
  /** Increments on every edit; PUT …/comments/:commentId sends it as If-Match. */
  revision: number;
  resolved: boolean;
}
export interface CommentsResponse {
  /**
   * Every comment in creation order, or with `?since=<cursor>` only those
   * created or edited (body or resolved) after that cursor, in change order.
   * Replies are listed flat; group them by `parentId`.
   */
  comments: CommentRecord[];
  /** The page's current version. */
  head: number;
  /**
   * Opaque. Pass it back as `?since=` to get only later changes; a comment is
   * returned again only if it changed again. Unchanged when nothing is new.
   */
  cursor: string;
}
/** GET /api/files/:id/context/:commentId: exactly what the commenter saw. */
export interface ContextResponse {
  comment: CommentRecord;
  context?: import("../contracts.ts").CommentContextStatus;
  /** Null when the original version was not retained. */
  source: string | null;
  /** The commenter's own local state when they commented (filters, open tabs, drafts). */
  state: AfJsonObject | null;
  /** The inert view the platform UI captured with the comment, when it sent one. */
  rendered?: string;
  /**
   * The page's address with `#af-state=` of `state`, so opening it shows the
   * page as the commenter saw it (the plain address when no state was saved).
   */
  url: string | null;
}
export interface ReserveIdsRequest {
  count: number;
}
export interface ReserveIdsResponse {
  ids: FileId[];
}
export interface TokenResponse {
  token: string;
  username: string;
}
/**
 * GET /skills/pagegi-author.tgz: skills/pagegi-author/ as a gzip tarball
 * (ustar) whose entries all start with `pagegi-author/`, so
 * `curl -fsSL <origin>/skills/pagegi-author.tgz | tar -xz -C <skills folder>`
 * installs the skill. Built once from the skill directory and kept in memory.
 */
export interface SkillArchive {
  body: Uint8Array;
  headers: Record<string, string>;
}

/**
 * Publish and save rules (B, using PageModelModule.prepareForSave and C's
 * BackendFilesPort):
 * - The page's ID is a new random file ID when the meta block names none. An
 *   ID it names must be reserved by the caller and not yet published, and is
 *   then used; any other ID (someone else's, already published, unknown) is
 *   422 naming it, so a copied page is never published under a new ID by
 *   accident (take `id` out of the meta block to publish it as a new page).
 * - Every `files` key must be linked from the page by an af-backend link and
 *   be either reserved by the caller and unpublished, or a backend file the
 *   caller owns; otherwise 422 naming the ID. A linked ID that is neither
 *   published nor in `files` is 422. Duplicate or missing `data-af-name` is 422.
 * - Publish and save are atomic: if a backend file fails to compile, nothing is saved (422).
 * - Saved source has every KNOWN_AF_ORIGINS prefix (`https://pagegi.artifactbin.dev/af/v1/`,
 *   `https://artifactbin.dev/af/v1/`, and every other configured known origin)
 *   rewritten to the server's own public origin.
 */
export interface AfServiceOptions {
  connectionString?: string;
  schema?: string;
  now?: () => number;
  sendCode?: (message: { to: string; code: string }) => Promise<void>;
  /** Enables POST /api/auth/test-token. Refused (throws) when NODE_ENV is "production". */
  testLogin?: boolean;
  /** The server's public origin; when absent, the request's own origin is used. */
  platformOrigin?: string;
  runnerOrigin?: string;
  /** Origins rewritten to this server on save, always besides KNOWN_AF_ORIGINS. */
  knownOrigins?: readonly string[];
  backendHost?: import("../backend/contracts.ts").BackendHost;
  /**
   * PAGEGI_SECRETS_KEY decoded: 32 bytes that encrypt account secrets at rest
   * (./secrets-contracts.ts). Without it the /api/secrets routes answer 503
   * and every lambda's `env` is `{}`.
   */
  secretsKey?: Uint8Array;
  /** Random source for file IDs; tests may inject a deterministic one. */
  randomBytes?: (count: number) => Uint8Array;
}
/** The subset of node:http's Server that callers use (contracts may not import node:). */
export interface AfHttpServer {
  listen(port: number, host: string, callback: () => void): unknown;
  address(): { port: number } | string | null;
  closeAllConnections(): void;
  close(callback?: (error?: Error) => void): unknown;
}
export interface AfService {
  server: AfHttpServer;
  close(): Promise<void>;
}
/** Shape of src/server.js after phase 1. */
export interface AfServerModule {
  createService(options?: AfServiceOptions): AfService;
}

/**
 * Plain start script, src/server-main.js (no CLI): reads env through
 * src/config.js and listens. `npm start` runs it.
 *   PAGEGI_PORT (default 8787), PAGEGI_HOST (default 127.0.0.1),
 *   PAGEGI_TEST_LOGIN=1 enables testLogin, PAGEGI_KNOWN_ORIGINS is a
 *   comma-separated list added to KNOWN_AF_ORIGINS, PAGEGI_SECRETS_KEY is
 *   the account secrets key (32 bytes, base64 or hex; see ./secrets-contracts.ts).
 */
export interface ServerMainEnv {
  PAGEGI_PORT?: string;
  PAGEGI_HOST?: string;
  PAGEGI_TEST_LOGIN?: string;
  PAGEGI_KNOWN_ORIGINS?: string;
  PAGEGI_SECRETS_KEY?: string;
}

/** A route module brief C provides and brief B mounts before its own file routes. */
export interface AfRouteRequest {
  method: string;
  url: URL;
  /** Bearer credential, "" when absent. */
  credential: string;
  body: AfJsonObject;
  signal: AbortSignal;
}
export interface AfRouteResponse {
  status: number;
  body: unknown;
}
export interface AfRouteModule {
  /** Returns null when the path is not one of this module's routes. */
  handle(request: AfRouteRequest): Promise<AfRouteResponse | null>;
}
