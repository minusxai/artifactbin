/**
 * THE one retry policy for client-side HTTP, shared by the reader (lib/artifact-backend) and the installed
 * skill scripts (skills/artifactbin/scripts/toolbox-client.mjs, reached through toolbox-platform.mjs so the
 * packaged archive carries it). Pure: no DOM, no Node; time and randomness are injectable.
 *
 * It exists to ride out a deploy restart: a network error or a 502/503/504 is retried with backoff
 * (0.5, 1, 2, 4, 8 s with +-10% jitter), never past an overall 15 s cap. Everything else is the server's answer
 * and comes back at once — every 4xx included.
 *
 * A request may be repeated only when repeating cannot double-apply it: GET/HEAD/OPTIONS, a request the caller
 * declares `safeToRepeat` (a query, a desired-state PUT), or a write carrying an `idempotencyKey`. The key is
 * handed to every attempt, so it is the same on each. Any other request is sent exactly once.
 *
 * `send` is called afresh per attempt and must build its own body (a stream cannot be re-sent). A retryable
 * response that is discarded is cancelled, never read; the response finally returned is untouched, so the caller
 * reads its body once. The final failure is surfaced unchanged: the last Response, or the last thrown error with
 * `attempts` added.
 */
export interface RetryPolicy {
  /** Wait before retry n (0-based); its length is the retry budget. */
  delaysMs: readonly number[];
  /** Fraction of each wait randomised, 0.1 = +-10%. */
  jitter: number;
  /** Overall cap on elapsed time from the first attempt; a wait never extends past it. */
  maxTotalMs: number;
  /** Cap on a server's Retry-After (honoured on 503). */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { delaysMs: [500, 1000, 2000, 4000, 8000], jitter: 0.1, maxTotalMs: 15_000, maxRetryAfterMs: 10_000 };

export interface RetryOptions {
  method?: string;
  /** Sent identically on every attempt; makes a write repeatable. */
  idempotencyKey?: string;
  /** The caller vouches that repeating this request is harmless. */
  safeToRepeat?: boolean;
  signal?: AbortSignal;
  policy?: Partial<RetryPolicy>;
  /** Called with true when a wait starts and false when it ends (a "retrying…" note). */
  onWait?: (waiting: boolean) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export interface RetryResult { response: Response; attempts: number }
export interface SendContext { attempt: number; idempotencyKey: string | undefined }

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isRetryableStatus(status: number): boolean { return RETRYABLE_STATUS.has(status); }

/** Retry-After as milliseconds: delta-seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(response: Response, now: number): number | null {
  const raw = response.headers.get('Retry-After')?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(abortReason(signal)); return; }
  const onAbort = () => { clearTimeout(timer); reject(abortReason(signal!)); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

function withAttempts(error: unknown, attempts: number): unknown {
  if (error && typeof error === 'object') { try { (error as { attempts?: number }).attempts = attempts; } catch { /* frozen: surfaced as is */ } }
  return error;
}

export async function retryFetch(send: (context: SendContext) => Promise<Response>, options: RetryOptions = {}): Promise<RetryResult> {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.policy };
  const { signal, onWait, idempotencyKey } = options;
  const sleep = options.sleep ?? defaultSleep, random = options.random ?? Math.random, now = options.now ?? Date.now;
  const repeatable = SAFE_METHODS.has((options.method ?? 'GET').toUpperCase()) || options.safeToRepeat === true || idempotencyKey !== undefined;
  const started = now();
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw withAttempts(abortReason(signal), attempt - 1);
    let response: Response | undefined;
    let failure: unknown;
    try { response = await send({ attempt, idempotencyKey }); } catch (error) { failure = error; }
    if (response && !isRetryableStatus(response.status)) return { response, attempts: attempt };
    // An abort is the caller's decision, never a transient fault.
    if (failure !== undefined && signal?.aborted) throw withAttempts(failure, attempt);
    const retryIndex = attempt - 1;
    const base = policy.delaysMs[retryIndex];
    const remaining = policy.maxTotalMs - (now() - started);
    if (!repeatable || base === undefined || remaining <= 0) {
      if (response) return { response, attempts: attempt };
      throw withAttempts(failure, attempt);
    }
    let wait = base * (1 + (random() * 2 - 1) * policy.jitter);
    const hinted = response?.status === 503 ? retryAfterMs(response, now()) : null;
    if (hinted !== null) wait = Math.min(hinted, policy.maxRetryAfterMs);
    wait = Math.max(0, Math.min(wait, remaining));
    // The discarded response is cancelled unread so its connection is freed.
    if (response) void response.body?.cancel().catch(() => undefined);
    onWait?.(true);
    try { await sleep(wait, signal); }
    catch (error) { throw withAttempts(error, attempt); }
    finally { onWait?.(false); }
  }
}
