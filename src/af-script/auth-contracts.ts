/**
 * auth.mjs and the credential file every other script reads (model:
 * ./auth-model.ts, pure over injected ports).
 *
 * The credential file: `${AF_HOME:-$HOME/.af}/credentials.json`, mode 0600 in
 * a 0700 directory, written atomically:
 *   { "<origin>": { "token": "...", "email": "...", "savedAt": "<iso>" } }
 * Keys are plain origins (`new URL(AF_SERVER).origin`). Nothing else is kept.
 *
 * Token resolution (resolveToken), used by add, publish and comments
 * (shot sends no token):
 *   1. AF_TOKEN, when set and not empty;
 *   2. else the file's entry for the current server (AF_SERVER, default
 *      DEFAULT_AF_ORIGIN, as an origin);
 *   3. else exit 2, naming `auth.mjs --email <address>`, AF_TOKEN and AF_SERVER.
 * A 401 from any script exits 2 with refusedMessage(): run auth.mjs to sign in again.
 * A server that answers 404 to a sign-in route, or to an API route and the
 * session route both, is not a Pagegi server: exit 2 with notPagegiMessage(),
 * which names AF_SERVER (status reports it as `unknown` with that detail).
 *
 * auth.mjs:
 *   (no flags)                       status: every saved server, plus the current
 *                                    one, checked with one GET /api/auth/session each.
 *                                    Exit 0 when the current server's token works, else 1.
 *   --email <address>                POST /api/auth/email/request; exit 0 when sent.
 *   --email <address> --code <code>  POST /api/auth/email/verify; saves the token.
 *   --test-token --email <address>   POST /api/auth/test-token (development servers
 *                                    only; 404 elsewhere); saves the token.
 *   --logout                         removes the current server's entry (local only).
 *   --json                           one AuthJson object on stdout.
 * Exit codes: EXIT in ./lifecycle-contracts.ts: 0 done, 1 refused or not signed in,
 * 2 usage or environment, 3 the server failed or could not be reached.
 * A token is never printed, in text or JSON.
 */
import type { AfFetch } from "./af-contracts.ts";

/** Overrides the directory that holds credentials.json (default `$HOME/.af`). */
export const AF_HOME_ENV = "AF_HOME";
export const CREDENTIALS_FILE = "credentials.json";
/** The whoami route auth.mjs checks a token with: 200 { username }, 401 when the token is not valid. */
export const SESSION_PATH = "/api/auth/session";

export interface SavedCredential {
  token: string;
  /** The account, as the server named it when the token was issued. */
  email: string;
  /** ISO time it was saved. */
  savedAt: string;
}
/** credentials.json */
export type CredentialFile = Record<string, SavedCredential>;

/** A token a script will send, and where it came from. */
export interface ResolvedToken {
  /** The current server, as an origin. */
  origin: string;
  token: string;
  source: "AF_TOKEN" | "credentials";
  /** The saved account, when the token came from the file. */
  email: string | null;
}

/** The file system auth.mjs needs: reads, and private atomic writes. */
export interface CredentialFilePort {
  /** The file's text, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  /**
   * Write atomically (temporary file, then rename). With `private`, the file is
   * created 0600 and its directory created, or tightened, to 0700.
   */
  write(path: string, text: string, options?: { private?: boolean }): Promise<void>;
}

export interface AuthPorts {
  fetch: AfFetch;
  fs: CredentialFilePort;
  /** Milliseconds since the epoch, for savedAt. */
  now(): number;
}

export type AuthAction =
  | { kind: "status" }
  | { kind: "request"; email: string }
  | { kind: "verify"; email: string; code: string }
  | { kind: "test-token"; email: string }
  | { kind: "logout" };

/** One server in `auth.mjs` status. */
export interface AuthServerStatus {
  server: string;
  /** The account: the server's answer when it gave one, else the saved email; null when unknown. */
  email: string | null;
  /** Where the token comes from. AF_TOKEN applies to the current server only. */
  source: "AF_TOKEN" | "credentials" | null;
  current: boolean;
  /** signed-in: the token works; signed-out: none saved, or the server refused it (401); unknown: no clear answer. */
  state: "signed-in" | "signed-out" | "unknown";
  /** Why, when not signed in. */
  detail: string | null;
}

/** `auth.mjs --json`: one object. Never contains a token. */
export interface AuthJson {
  status: "sent" | "signed-in" | "signed-out" | "status" | "error";
  /** The current server. */
  server: string;
  /** The account signed in, or the address given with --email, also on an error. */
  email: string | null;
  /** The credential file. */
  file: string;
  /** Only for status. */
  servers?: AuthServerStatus[];
  message: string;
}

export interface AuthContext {
  env: Readonly<Record<string, string | undefined>>;
  ports: AuthPorts;
  stdout(text: string): void;
  stderr(text: string): void;
}

/** Shape of ./auth-model.ts. */
export interface AuthModelModule {
  /** `new URL(AF_SERVER || DEFAULT_AF_ORIGIN).origin`; a Failure (exit 2) when AF_SERVER is not a URL. */
  currentServer(env: AuthContext["env"]): string;
  /** `${AF_HOME}/credentials.json`, else `${HOME}/.af/credentials.json`. */
  credentialsPath(env: AuthContext["env"]): string;
  /** The token resolution order above; a Failure (exit 2) when there is none. `what` completes "to …". */
  resolveToken(env: AuthContext["env"], fs: Pick<CredentialFilePort, "read">, what: string): Promise<ResolvedToken>;
  /** The message for a 401: the token was refused; run auth.mjs to sign in again. */
  refusedMessage(token: Pick<ResolvedToken, "origin" | "source" | "email">): string;
  /** The message when `origin` answered 404 to `path` and is not a Pagegi server: set AF_SERVER. */
  notPagegiMessage(origin: string, path: string): string;
  /** Run auth.mjs; returns the exit code. */
  runAuth(action: AuthAction, json: boolean, context: AuthContext): Promise<number>;
}
