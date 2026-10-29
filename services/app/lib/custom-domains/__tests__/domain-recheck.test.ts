/** The background re-check never throws out of its timer: a failing resolver is logged, and the loop keeps running. */
import { afterEach, expect, it, vi } from 'vitest';
import { startDomainRecheck } from '@/lib/custom-domains';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('logs a resolver factory that throws, at start and on every later tick, instead of throwing', async () => {
  vi.useFakeTimers();
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const resolve = vi.fn(() => { throw new Error('resolver unavailable'); });
  let stop: (() => Promise<void>) | undefined;
  expect(() => { stop = startDomainRecheck(resolve, 1000); }).not.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(logged).toHaveBeenCalledTimes(2);
  expect(String(logged.mock.calls[0]?.[1])).toContain('resolver unavailable');
  await stop!();
});
