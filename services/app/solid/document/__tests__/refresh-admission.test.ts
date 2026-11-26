import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { documentAdmissionReader } from '../refresh-admission';

const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
};
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it('coalesces a request during an outstanding read into one more read, never aborting it', async () => {
  const first = deferred(), second = deferred();
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((_url: string, init: RequestInit) => { signals.push(init.signal!); return signals.length === 1 ? first.promise : second.promise; });
  const apply = vi.fn();
  await createRoot(async (dispose) => {
    const read = documentAdmissionReader({ fetch } as unknown as Window, 'abc', apply);
    const a = read(), b = read(), c = read();
    first.resolve(answer({ role: 'stale' }));
    await Promise.resolve(); await Promise.resolve();
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    second.resolve(answer({ role: 'fresh' }));
    await Promise.all([a, b, c]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ role: 'fresh' });
    dispose();
  });
});

it('applies a definitive refusal, ignores other failures and aborts on disposal', async () => {
  const pending = deferred();
  const responses = [Promise.resolve(answer({}, 404)), Promise.resolve(answer({}, 503)), pending.promise];
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((_url: string, init: RequestInit) => { signals.push(init.signal!); return responses.shift()!; });
  const apply = vi.fn();
  await createRoot(async (dispose) => {
    const read = documentAdmissionReader({ fetch } as unknown as Window, 'abc', apply);
    await read();
    expect(apply).toHaveBeenLastCalledWith(null);
    await read();
    expect(apply).toHaveBeenCalledTimes(1);
    void read();
    dispose();
    expect(signals.at(-1)!.aborted).toBe(true);
    pending.resolve(answer({ role: 'late' }));
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
