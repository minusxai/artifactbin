import { timingSafeEqual } from 'node:crypto';
/**
 * Resolve authentication for a standalone internal service process.
 * Production is fail-closed; tests and local development may intentionally
 * omit the secret and exercise the same server through its explicit API.
 */
export function serviceSecretForServer(env: NodeJS.ProcessEnv): string | undefined {
  const secret = env.INTERNAL__SERVICE_SECRET?.trim();
  if (env.NODE_ENV === 'production' && !secret) {
    throw new Error('INTERNAL__SERVICE_SECRET is required in production');
  }
  return secret || undefined;
}

/**
 * Does `presented` (the SERVICE_AUTH_HEADER value) carry `expected`, the INTERNAL__SERVICE_SECRET? Constant time;
 * an unset or empty secret matches nothing, so a deployment without one refuses every service call.
 */
export function serviceSecretMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  const given = Buffer.from(presented ?? ''), wanted = Buffer.from(expected ?? '');
  return wanted.length > 0 && given.length === wanted.length && timingSafeEqual(given, wanted);
}
