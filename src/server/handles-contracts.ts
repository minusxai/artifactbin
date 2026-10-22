/**
 * Account handles: the optional public name in a page's `/@<handle>/<path>`
 * address, so that address never shows the account's email. Implementation:
 * src/server/handles.ts (the pure rule, the accounts.handle column and the
 * routes). The exact surface is in skills/pagegi-author/references/http-api.md.
 *
 * Rules:
 * - An account has at most one handle; a new account has none.
 * - A handle is HANDLE_MIN..HANDLE_MAX characters of lowercase a-z, 0-9 and
 *   "_" and "-", with no leading, trailing or double "-". Underscores may
 *   appear anywhere, including repeated or at either end. Input is trimmed and
 *   lowercased first, so "Alice" is saved as "alice" and handles are unique
 *   case-insensitively.
 * - RESERVED_HANDLES (platform words and the server's top-level routes) are refused.
 * - Changing or clearing a handle frees the old one at once: its `/@old/…`
 *   addresses are 404 (no redirect) and another account may take it.
 * - `/@<handle>/<path>` resolves only through handles: an account without one
 *   has no such address, and an email in that position is 404.
 * - One exception for continuity: `/@<handle>/<id>` or `/@<handle>/<id>-<title>`
 *   that matches no path is 308 to `/a/<id>` (src/ids/file-id-contracts.ts).
 *
 * Routes (all need a valid account: bearer token, or the home page's cookie
 * session; 401 otherwise):
 *   GET    /api/account/handle               → 200 HandleResponse
 *   PUT    /api/account/handle  { handle }   → 200 HandleResponse; 409 when another account
 *                                              has it; 422 when it breaks a rule above
 *   DELETE /api/account/handle               → 200 { handle: null } (also when there was none)
 */
import type { SqlClient } from "../backend/af-backend-contracts.ts";

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 32;
export const HANDLE_PATTERN = /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/;
/** Words a handle can never be: platform names and the server's top-level paths. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "a",
  "af",
  "api",
  "connect",
  "install",
  "example",
  "skills",
  "health",
  "admin",
  "pagegi",
  "artifactbin",
  "afbin",
  "platform-frame",
  "runtime",
  "home",
  "account",
  "sharing",
  "identity",
  "theme",
  "navigation",
  "file-browser",
  "trusted-connection",
  "login",
  "logout",
  "settings",
  "help",
  "support",
  "root",
  "system",
  "null",
  "undefined",
]);

export interface HandleResponse {
  handle: string | null;
}
export interface HandleWriteRequest {
  handle: string;
}

/** Why a handle is refused, or null when it may be saved. Pure; input already normalized. */
export type HandleProblem = "length" | "characters" | "reserved";

/** The accounts.handle column, inside a caller's transaction. */
export interface HandleStore {
  read(client: SqlClient, actor: string): Promise<string | null>;
  /** Saves the normalized handle. 422 for a rule, 409 when another account holds it. */
  set(client: SqlClient, actor: string, handle: unknown): Promise<string>;
  clear(client: SqlClient, actor: string): Promise<void>;
  /** The account holding `handle` (matched after normalizing), or null. */
  actor(client: SqlClient, handle: string): Promise<string | null>;
}

/** Shape of src/server/handles.ts. */
export interface HandlesModule {
  /** Trimmed and lowercased; non-strings become "". */
  normalizeHandle(value: unknown): string;
  handleProblem(normalized: string): HandleProblem | null;
  handleStore: HandleStore;
  /** The /api/account/handle routes (AfRouteModule); `actor` resolves the credential or throws the 401. */
  createHandleRoutes(options: {
    database: import("../backend/af-backend-contracts.ts").SqlDatabase;
    actor(credential: string): Promise<string>;
  }): import("./af-api-contracts.ts").AfRouteModule;
}
