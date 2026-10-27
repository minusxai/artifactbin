/** The one retry policy: what it retries, what it never does, and how long it may take. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RETRY_POLICY, retryFetch, retryAfterMs } from '../retry';

const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify({ status }), { status, headers });
type Step = Response | Error;
function rig(...steps: Step[]) {
  const calls: Array<{ attempt: number; key: string | undefined; at: number }> = [];
  const queue = [...steps];
  const send = vi.fn(async ({ attempt, idempotencyKey }: { attempt: number; idempotencyKey: string | undefined }) => {
    calls.push({ attempt, key: idempotencyKey, at: Date.now() });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return next.clone();
  });
  return { send, calls };
}
const noJitter = { jitter: 0 };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

/** Run to completion while the fake clock advances through every wait. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false; const guarded = promise.finally(() => { done = true; });
  guarded.catch(() => undefined);
  while (!done) { await vi.advanceTimersByTimeAsync(250); }
  return guarded;
}

describe('retryFetch', () => {
  it('502 then 200 succeeds, sending twice', async () => {
    const { send } = rig(res(502), res(200));
    const out = await settle(retryFetch(send, { method: 'GET', policy: noJitter }));
    expect(out.response.status).toBe(200);
    expect(out.attempts).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries a network error, then succeeds', async () => {
    const { send } = rig(new TypeError('Failed to fetch'), res(200));
    const out = await settle(retryFetch(send, { method: 'GET', policy: noJitter }));
    expect(out.response.status).toBe(200);
    expect(out.attempts).toBe(2);
  });

  it.each([400, 401, 403, 404, 409, 422])('never retries a %i', async (status) => {
    const { send } = rig(res(status), res(200));
    const out = await retryFetch(send, { method: 'POST', idempotencyKey: 'k'.repeat(20), policy: noJitter });
    expect(out.response.status).toBe(status);
    expect(out.attempts).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries 504 and 503 but not 500 or 501', async () => {
    for (const [status, calls] of [[504, 2], [503, 2], [500, 1], [501, 1]] as const) {
      const { send } = rig(res(status), res(200));
      await settle(retryFetch(send, { method: 'GET', policy: noJitter }));
      expect(send, String(status)).toHaveBeenCalledTimes(calls);
    }
  });

  it('backs off 0.5, 1, 2, 4, 8 s and then surfaces the last response with its attempt count', async () => {
    const { send, calls } = rig(res(502));
    const out = await settle(retryFetch(send, { method: 'GET', policy: noJitter }));
    expect(out.response.status).toBe(502);
    expect(out.attempts).toBe(6);
    // The last wait (8 s) is clamped to what is left of the 15 s cap.
    expect(calls.map((c) => c.at)).toEqual([0, 500, 1500, 3500, 7500, 15_000]);
  });

  it('surfaces the last thrown error unchanged, carrying the attempts', async () => {
    const boom = new TypeError('Failed to fetch');
    const { send } = rig(boom);
    const error = await settle(retryFetch(send, { method: 'GET', policy: noJitter }).catch((e) => e));
    expect(error).toBe(boom);
    expect(error.message).toBe('Failed to fetch');
    expect(error.attempts).toBeGreaterThan(1);
  });

  it('honours Retry-After on 503, capped, and never past the overall cap', async () => {
    const small = rig(res(503, { 'Retry-After': '2' }), res(200));
    await settle(retryFetch(small.send, { method: 'GET', policy: noJitter }));
    expect(small.calls[1]!.at - small.calls[0]!.at).toBe(2000);

    vi.setSystemTime(0);
    const huge = rig(res(503, { 'Retry-After': '3600' }), res(200));
    await settle(retryFetch(huge.send, { method: 'GET', policy: noJitter }));
    expect(huge.calls[1]!.at - huge.calls[0]!.at).toBe(DEFAULT_RETRY_POLICY.maxRetryAfterMs);

    vi.setSystemTime(0);
    const date = rig(res(503, { 'Retry-After': new Date(3000).toUTCString() }), res(200));
    await settle(retryFetch(date.send, { method: 'GET', policy: noJitter }));
    expect(date.calls[1]!.at).toBe(3000);
    expect(retryAfterMs(res(503, { 'Retry-After': 'soon' }), 0)).toBeNull();
    expect(retryAfterMs(res(502, {}), 0)).toBeNull();
  });

  it('ignores Retry-After on a 502', async () => {
    const { send, calls } = rig(res(502, { 'Retry-After': '9' }), res(200));
    await settle(retryFetch(send, { method: 'GET', policy: noJitter }));
    expect(calls[1]!.at).toBe(500);
  });

  it('keeps the same idempotency key on every attempt', async () => {
    const { send, calls } = rig(res(502), new TypeError('offline'), res(503), res(200));
    await settle(retryFetch(send, { method: 'POST', idempotencyKey: 'key-0123456789abcdef', policy: noJitter }));
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((c) => c.key))).toEqual(new Set(['key-0123456789abcdef']));
  });

  it('sends a non-idempotent request without a key exactly once', async () => {
    for (const first of [res(502), new TypeError('offline')] as Step[]) {
      const { send } = rig(first, res(200));
      const out = await retryFetch(send, { method: 'POST', policy: noJitter }).then((r) => r, (e) => e);
      expect(send).toHaveBeenCalledTimes(1);
      if (out instanceof Error) expect(out.message).toBe('offline'); else expect(out.response.status).toBe(502);
    }
  });

  it('retries a declared-safe write (a query, a desired-state PUT) without a key', async () => {
    const { send } = rig(res(502), res(200));
    const out = await settle(retryFetch(send, { method: 'POST', safeToRepeat: true, policy: noJitter }));
    expect(out.attempts).toBe(2);
  });

  it('stops at once when aborted during a backoff, with no further request', async () => {
    const controller = new AbortController();
    const { send } = rig(res(502), res(200));
    const run = retryFetch(send, { method: 'GET', policy: noJitter, signal: controller.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    const error = await run;
    expect(error).toBe(controller.signal.reason);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send at all when already aborted, and never retries an abort thrown by send', async () => {
    const pre = new AbortController(); pre.abort();
    const a = rig(res(200));
    await expect(retryFetch(a.send, { method: 'GET', signal: pre.signal })).rejects.toBeDefined();
    expect(a.send).not.toHaveBeenCalled();

    const live = new AbortController();
    const send = vi.fn(async () => { live.abort(); throw new DOMException('Aborted', 'AbortError'); });
    await expect(retryFetch(send, { method: 'GET', signal: live.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never exceeds the overall cap, even with slow attempts and jitter', async () => {
    const send = vi.fn(async () => { await new Promise((r) => setTimeout(r, 4000)); return res(502); });
    const start = Date.now();
    const out = await settle(retryFetch(send, { method: 'GET', random: () => 1 }));
    expect(out.response.status).toBe(502);
    // Waits are clamped to the cap; only an attempt already in flight can run past it.
    expect(Date.now() - start).toBeLessThanOrEqual(15_000 + 4000);
    expect(send.mock.calls.length).toBeGreaterThan(1);
  });

  it('applies jitter within +-10% of each wait', async () => {
    const { send, calls } = rig(res(502), res(200));
    await settle(retryFetch(send, { method: 'GET', random: () => 1 }));
    expect(calls[1]!.at).toBe(550);
    const low = rig(res(502), res(200)); vi.setSystemTime(0);
    await settle(retryFetch(low.send, { method: 'GET', random: () => 0 }));
    expect(low.calls[1]!.at).toBe(450);
  });

  it('never reads a response body: a retried one is cancelled, the final one is left unread', async () => {
    const bodies: Response[] = [];
    const send = vi.fn(async () => { const r = res(502); bodies.push(r); return r; });
    const out = await settle(retryFetch(send, { method: 'GET', policy: { ...noJitter, delaysMs: [10, 10] } }));
    expect(out.response.bodyUsed).toBe(false);
    expect(out.response).toBe(bodies.at(-1));
    await expect(out.response.json()).resolves.toEqual({ status: 502 });
  });

  it('announces waits so a surface can say "retrying…"', async () => {
    const onWait = vi.fn();
    const { send } = rig(res(502), res(200));
    await settle(retryFetch(send, { method: 'GET', policy: noJitter, onWait }));
    expect(onWait.mock.calls).toEqual([[true], [false]]);
  });
});
