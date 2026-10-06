import type { RemoteSessionInfo } from '../../../contracts/src/remote';
export const MANAGED_RESTART_BUDGET_MS = 30_000;

type StartResponse = { ok: boolean; status: number; headers: Headers; json(): Promise<unknown> };
type StartResult = { session: RemoteSessionInfo };
type StartOptions = {
  body: string;
  signal: AbortSignal;
  fetcher?: (url: string, init: RequestInit) => Promise<StartResponse>;
  onPending?: () => void;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  budgetMs?: number;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const onAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retry only the explicit same-name teardown response, within one click's fixed budget. */
export async function startManagedRun({ body, signal, fetcher = fetch, onPending, now = Date.now, sleep: wait = sleep, budgetMs = MANAGED_RESTART_BUDGET_MS }: StartOptions): Promise<StartResult> {
  const deadline = now() + budgetMs;
  let sawPending = false;
  const timeoutError = () => new Error(sawPending ? 'The previous hosted box is still stopping. Try again shortly.' : 'Could not start your hosted box in time. Try again.');
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    const remaining = deadline - now();
    if (remaining <= 0) throw timeoutError();
    const timeout = AbortSignal.timeout(remaining);
    let response: StartResponse;
    try {
      response = await fetcher('/api/runs', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body, signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      if (!signal.aborted && timeout.aborted) throw timeoutError();
      throw error;
    }
    const result = await response.json().catch(() => null);
    if (response.ok) {
      if (result && typeof result === 'object' && 'session' in result && result.session && typeof result.session === 'object' && 'id' in result.session && typeof result.session.id === 'string' && result.session.id) return { session: result.session as RemoteSessionInfo };
      throw new Error('The hosted box started, but the server returned an invalid session. Refresh and check your sessions.');
    }
    const error = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : undefined;
    if (response.status !== 409 || error !== 'box_restart_pending') throw new Error(error ?? 'Could not start your agent');
    sawPending = true;
    onPending?.();
    const after = Number(response.headers.get('Retry-After'));
    const delay = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 2_000) : 1_000;
    if (deadline - now() <= delay) throw new Error('The previous hosted box is still stopping. Try again shortly.');
    await wait(delay, signal);
  }
}
