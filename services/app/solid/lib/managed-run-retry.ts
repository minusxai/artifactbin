import type { RemoteSessionInfo } from '../../../contracts/src/remote';
const MANAGED_RESTART_BUDGET_MS = 8 * 60_000;
const MANAGED_START_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15_000;

type StartResponse = { ok: boolean; status: number; headers: Headers; json(): Promise<unknown> };
type StartResult = { session: RemoteSessionInfo };
type StartOptions = {
  body: string;
  signal: AbortSignal;
  fetcher?: (url: string, init: RequestInit) => Promise<StartResponse>;
  onPending?: (elapsedMs: number) => void;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  budgetMs?: number;
  requestTimeoutMs?: number;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function pendingError() { return new Error('The previous hosted box is still stopping. Check your sessions before starting again.'); }

/** Retry only the explicit same-name teardown response, within one click's fixed budget. */
export async function startManagedRun({ body, signal, fetcher = fetch, onPending, now = Date.now, sleep: wait = sleep, budgetMs = MANAGED_RESTART_BUDGET_MS, requestTimeoutMs = MANAGED_START_REQUEST_TIMEOUT_MS }: StartOptions): Promise<StartResult> {
  const startedAt = now();
  const deadline = startedAt + budgetMs;
  let sawPending = false;
  let retries = 0;
  const timeoutError = () => new Error(sawPending ? 'The previous hosted box is still stopping. Check your sessions before starting again.' : 'Could not start your hosted box in time. Try again.');
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    const remaining = deadline - now();
    if (remaining <= 0) throw timeoutError();
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = Math.max(1, Math.min(requestTimeoutMs, remaining));
    const timeout = setTimeout(() => { timedOut = true; controller.abort(new DOMException('Request timed out', 'TimeoutError')); }, timeoutMs);
    const abortRequest = () => controller.abort(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abortRequest, { once: true });
    let response: StartResponse;
    let result: unknown;
    try {
      response = await fetcher('/api/runs', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body, signal: controller.signal,
      });
      result = await response.json().catch(() => null);
      if (timedOut) throw new Error('request timed out');
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      if (timedOut) throw new Error(sawPending ? 'The previous hosted box is still stopping. Check your sessions before starting again.' : 'The hosted box request timed out. Check your sessions before trying again.');
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abortRequest);
    }
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (response.ok) {
      if (result && typeof result === 'object' && 'session' in result && result.session && typeof result.session === 'object' && 'id' in result.session && typeof result.session.id === 'string' && result.session.id) return { session: result.session as RemoteSessionInfo };
      throw new Error('The hosted box started, but the server returned an invalid session. Refresh and check your sessions.');
    }
    const error = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : undefined;
    if (response.status !== 409 || error !== 'box_restart_pending') throw new Error(error ?? 'Could not start your agent');
    sawPending = true;
    const elapsed = Math.max(0, now() - startedAt);
    onPending?.(elapsed);
    const after = Number(response.headers.get('Retry-After'));
    const serverDelay = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, MAX_RETRY_DELAY_MS) : 0;
    const clientDelay = Math.min(1_000 * (2 ** Math.min(retries, 4)), MAX_RETRY_DELAY_MS);
    const delay = Math.max(serverDelay, clientDelay);
    retries++;
    const untilDeadline = deadline - now();
    if (untilDeadline <= delay) throw pendingError();
    await wait(delay, signal);
  }
}
