/**
 * THE SCAFFOLDING EVERY ADMIN MIGRATION CLI SHARES.
 *
 * A migration CLI is a thin operator front door: it parses a few flags, holds
 * `ADMIN__SECRET`, and POSTs batches to one `/api/admin/*` route until the
 * server says it is done. The app is the only thing that opens the database —
 * a second process opening PGLite would corrupt it — so everything here is
 * HTTP.
 *
 * The parts below were copy-pasted between the two CLIs, which is how the
 * transport rules (no redirects, a deadline, retry only a 5xx or a dropped
 * connection, never print the secret) ended up written twice and drifted in
 * formatting. They are one implementation now; what differs per migration is
 * the route and what to DO with each report, which stays in the script.
 */

const integer = (name, value, min, max) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer from ${min} through ${max}`);
  return parsed;
};

/**
 * The flags every migration takes, plus whatever the caller adds.
 *
 * The URL rules are a credential-transport guard, not cosmetics: the secret
 * travels in a header, so userinfo in the URL would leak it into logs, and
 * cleartext is refused anywhere but loopback.
 *
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} [environment]
 * @param {Record<string, (out: Record<string, unknown>, value: string | undefined) => void>} [extraFlags]
 */
export function parseMigrationArgs(argv, environment = process.env, extraFlags = {}) {
  const out = { url: environment.APP__PUBLIC_BASE_URL || 'http://127.0.0.1:3000', dryRun: true, batchSize: 25, historyLimit: 1000, retries: 3 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') out.dryRun = false;
    else if (arg === '--url') out.url = argv[++i] ?? '';
    else if (arg === '--batch-size') out.batchSize = integer('batch size', argv[++i], 1, 100);
    else if (arg === '--history-limit') out.historyLimit = integer('history limit', argv[++i], 0, 10_000);
    else if (arg === '--retries') out.retries = integer('retries', argv[++i], 0, 5);
    else if (extraFlags[arg]) extraFlags[arg](out, argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  let url;
  try { url = new URL(out.url); } catch { throw new Error('invalid migration URL'); }
  if (url.username || url.password) throw new Error('migration URL must not contain userinfo credentials');
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('refusing cleartext credential transport to a non-loopback host');
  out.url = url.origin;
  return out;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A writer that can never print the secret, whatever a server echoes back.
 * @param {string} secret
 * @param {((line: string) => void) | undefined} write
 */
export function redactingWriter(secret, write) {
  const raw = write ?? ((line) => console.log(line));
  return (line) => raw(String(line).split(secret).join('[REDACTED]'));
}

/**
 * ONE BATCH REQUEST, with the retry policy every migration wants: a 5xx or a
 * dropped connection is retried with backoff, anything the server actually
 * decided (4xx) is not — retrying a refusal only asks it to refuse again.
 *
 * Returns the report, or a failure whose message has already been written:
 * `request` (never got an answer), `conflict` (409 with conflicts — the
 * caller decides what to say), `response` (an answer that is not a report).
 *
 * @returns {Promise<{ok: true, report: any} | {ok: false, reason: 'request' | 'response'} | {ok: false, reason: 'conflict', report: any}>}
 */
export async function migrationRequest({ fetchFn = fetch, endpoint, secret, timeoutMs = 30_000, retries, body, write }) {
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetchFn(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', 'x-shared-secret': secret },
        body: JSON.stringify(body),
      });
    } catch {
      response = null;
    }
    if (response && response.status < 500) break;
    if (attempt >= retries) { write(`migration request failed after ${attempt + 1} attempt(s)`); return { ok: false, reason: 'request' }; }
    await delay(Math.min(1000, 100 * 2 ** attempt));
  }
  const report = await response.json().catch(() => null);
  if (response.status === 409 && report?.conflicts?.length) return { ok: false, reason: 'conflict', report };
  if (!response.ok || !report) { write(`migration request failed with HTTP ${response.status}`); return { ok: false, reason: 'response' }; }
  return { ok: true, report };
}

/**
 * The `main()` every migration CLI has: parse, demand the secret, run, and
 * turn a refusal into a non-zero exit without a stack trace.
 *
 * @param {() => Record<string, unknown>} parse
 * @param {(options: Record<string, unknown>) => Promise<{ok: boolean}>} run
 */
export async function runMigrationMain(parse, run) {
  try {
    const parsed = parse();
    const secret = process.env.ADMIN__SECRET;
    if (!secret) throw new Error('ADMIN__SECRET is not set');
    const result = await run({ ...parsed, secret });
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'migration failed');
    process.exitCode = 1;
  }
}
