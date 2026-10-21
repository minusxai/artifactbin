/**
 * Account secrets: named values an account stores once and its backend lambdas
 * read as their fourth resolver argument, `env` (`(args, principal, caps, env)`),
 * the way a Cloudflare Worker reads its bindings. Implementation:
 * src/server/secrets.ts (server role: crypto, SQL and the routes).
 *
 * Rules (the exact surface in skills/pagegi-author/references/http-api.md):
 * - A secret belongs to one account (`actor`), under a name matching
 *   SECRET_NAME. Values are 1..4096 bytes of UTF-8 without NUL (U+0000), and an
 *   account keeps at most 64 of them.
 * - Values are encrypted at rest (AES-256-GCM under PAGEGI_SECRETS_KEY, 32
 *   bytes as base64 or hex) and never leave the server over HTTP: every
 *   response carries names and times only.
 * - A lambda gets the secrets of the backend FILE'S OWNER (af_backend_files.owner),
 *   never the page owner's and never the caller's; a file whose owner has none
 *   gets `{}`.
 *
 * Routes (all need a valid account: bearer token, or the home page's cookie
 * session; 401 otherwise; 503 "Secrets are not configured" when the server
 * has no key):
 *   GET    /api/secrets         → 200 SecretsListResponse, sorted by name
 *   PUT    /api/secrets/:name   { value } → 200 SecretWriteResponse (create or replace);
 *                                 422 for a bad name, a bad value, or the 65th secret
 *   DELETE /api/secrets/:name   → 200 SecretDeleteResponse; 404 when there is no such secret
 */
import type { SqlClient } from "../backend/af-backend-contracts.ts";

export { SECRET_NAME, SECRET_VALUE_MAX_BYTES, MAX_SECRETS_PER_ACCOUNT } from "../backend/container/env-policy.mjs";
/** The key's length in bytes once decoded (AES-256). */
export const SECRETS_KEY_BYTES = 32;
export const SECRETS_NOT_CONFIGURED = "Secrets are not configured";

/** What a lambda receives as `env`: the owner's secrets by name. */
export type BackendEnv = Readonly<Record<string, string>>;

export interface SecretSummary {
  name: string;
  /** ISO time of the last PUT. */
  updatedAt: string;
}
export interface SecretsListResponse {
  secrets: SecretSummary[];
}
export interface SecretWriteRequest {
  value: string;
}
export type SecretWriteResponse = SecretSummary;
export interface SecretDeleteResponse {
  name: string;
  deleted: true;
}

/** Encrypts one value for one (actor, name) row; a ciphertext opens only under the same pair. */
export interface SecretCipher {
  seal(actor: string, name: string, value: string): string;
  /** Throws when the ciphertext was not sealed under this key for this actor and name. */
  open(actor: string, name: string, ciphertext: string): string;
}

/** The account_secrets table, inside a caller's transaction. */
export interface SecretsStore {
  list(client: SqlClient, actor: string): Promise<SecretSummary[]>;
  /** Create or replace. Throws a 422 error (status 422) for a bad name or value, or when the account is full. */
  set(client: SqlClient, actor: string, name: string, value: unknown): Promise<SecretSummary>;
  /** True when a secret was removed; false when there was none. */
  remove(client: SqlClient, actor: string, name: string): Promise<boolean>;
  /** Every secret of `owner`, decrypted, for a lambda's `env`; `{}` when there are none. */
  env(client: SqlClient, owner: string): Promise<BackendEnv>;
}

/** What createBackendRoutes needs: an owner's env, inside its own short read transaction. */
export type SecretsEnvPort = (client: SqlClient, owner: string) => Promise<BackendEnv>;

/** Shape of src/server/secrets.ts. */
export interface SecretsModule {
  /** 32 bytes as base64 (standard or url-safe) or 64 hex digits; throws otherwise. */
  parseSecretsKey(text: string): Uint8Array;
  createSecretCipher(key: Uint8Array): SecretCipher;
  createSecretsStore(options: { cipher: SecretCipher; now?: () => number }): SecretsStore;
  /**
   * The /api/secrets routes (AfRouteModule): `actor` resolves the request's
   * credential to an account or throws the 401. Without `store` every route is 503.
   */
  createSecretsRoutes(options: {
    database: import("../backend/af-backend-contracts.ts").SqlDatabase;
    actor(credential: string): Promise<string>;
    store?: SecretsStore;
  }): import("./af-api-contracts.ts").AfRouteModule;
}
