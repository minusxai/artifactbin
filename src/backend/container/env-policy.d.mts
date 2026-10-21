/** Shared policy for account-secret writes and isolated backend text bindings.
 * The implementation has no server, crypto, SQL or process dependencies. */
export const SECRET_NAME: RegExp;
export const SECRET_VALUE_MAX_BYTES: 4096;
export const MAX_SECRETS_PER_ACCOUNT: 64;
export const BACKEND_ENV_MAX_VALUE_BYTES: number;
export function validSecretName(value: unknown): value is string;
export function validSecretValue(value: unknown): value is string;
/** Accept a plain own-data JSON object only; never run getters. Return a sorted
 * defensive copy. Throw TypeError for invalid names/values/shape or bounds. */
export function checkedBackendEnv(value: unknown): Record<string, string>;
