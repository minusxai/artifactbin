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
