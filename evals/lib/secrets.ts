/**
 * Provider keys must not reach a log, a transcript, or an error message.
 *
 * The driver hands a key to a harness through its environment, and three things
 * then read that environment back: a harness's stdout (the transcript CI
 * uploads), a harness's stderr, and the CLIs themselves — `codex login`
 * rejects a bad key by echoing it, and `codex.prepare()` puts that stderr into
 * the Error it raises, which `main()` prints. Every one of those goes through
 * here first.
 */
const MASK = '***';

/** Replace every occurrence of every secret. Literal, never a pattern — a key may contain regex metacharacters. */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  return secrets.filter((s) => s.length > 0).reduce((acc, secret) => acc.split(secret).join(MASK), text);
}

/**
 * Secrets in play for this process. The driver registers each leg's key as it
 * resolves it, so the top-level error handler can scrub without threading the
 * keys through every call that might throw.
 */
const registered = new Set<string>();

export function registerSecret(secret: string): void {
  if (secret.length > 0) registered.add(secret);
}

export function scrubRegistered(text: string): string {
  return scrubSecrets(text, [...registered]);
}

/** The longest registered secret — how much of a stream must be held back so one cannot straddle two chunks. */
export function longestSecret(secrets: readonly string[]): number {
  return secrets.reduce((n, s) => Math.max(n, s.length), 0);
}
