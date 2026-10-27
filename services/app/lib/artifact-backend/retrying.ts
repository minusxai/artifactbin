/**
 * The reader backend's face of the shared retry policy (lib/http/retry): requests go through `retried`, and a
 * surface that wants a quiet "retrying…" subscribes with `watchRetrying`. The policy itself lives only in lib/http.
 */
import type { RetryOptions } from '@/lib/http/retry';

export const RETRY_TUNING: { policy?: RetryOptions['policy'] } = {};

const listeners = new Set<(retrying: boolean) => void>();
let waiting = 0;
const announce = (delta: number) => { waiting += delta; listeners.forEach((listener) => listener(waiting > 0)); };

export function watchRetrying(listener: (retrying: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A key that satisfies the server's 16-128 [A-Za-z0-9_-] rule. */
export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** One request through the shared policy; resolves to the final Response exactly as fetch would. */
export async function retried(send: (idempotencyKey: string | undefined) => Promise<Response>, options: Omit<RetryOptions, 'onWait' | 'policy' | 'first'> = {}): Promise<Response> {
  const { retryLazily } = await import('@/lib/http/retry-lazily');
  const { response } = await retryLazily(({ idempotencyKey }) => send(idempotencyKey), {
    ...options, policy: RETRY_TUNING.policy,
    onWait: (on) => announce(on ? 1 : -1),
  });
  return response;
}
