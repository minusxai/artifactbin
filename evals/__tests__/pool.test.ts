/**
 * Bounded concurrency: a leg's tasks run several at a time, so the pool must
 * keep RESULTS in the caller's order (a verdict is matched to its task by
 * index) while letting work finish out of order.
 */
import { describe, it, expect } from 'vitest';
import { mapConcurrent } from '../lib/pool';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapConcurrent', () => {
  it('keeps results in the ORDER OF THE INPUT even when the work finishes out of order', async () => {
    const out = await mapConcurrent([30, 5, 20, 1], 2, async (ms, i) => { await tick(ms); return i; });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('never runs more than `limit` at once, and still runs everything', async () => {
    let live = 0;
    let peak = 0;
    const ran: number[] = [];
    await mapConcurrent([...Array(9).keys()], 3, async (n) => {
      live += 1; peak = Math.max(peak, live);
      await tick(5);
      ran.push(n); live -= 1;
    });
    expect(peak).toBe(3);
    expect(ran.sort((a, b) => a - b)).toEqual([...Array(9).keys()]);
  });

  it('a limit at or above the item count runs them all together', async () => {
    let live = 0;
    let peak = 0;
    await mapConcurrent([1, 2, 3], 10, async () => { live += 1; peak = Math.max(peak, live); await tick(5); live -= 1; });
    expect(peak).toBe(3);
  });

  it('a limit of 1 is plain sequential execution', async () => {
    const order: number[] = [];
    await mapConcurrent([20, 1], 1, async (ms, i) => { await tick(ms); order.push(i); });
    expect(order).toEqual([0, 1]);
  });

  it('rejects if the work rejects, rather than resolving with a hole', async () => {
    await expect(mapConcurrent([1, 2], 2, async (n) => { if (n === 2) throw new Error('boom'); return n; })).rejects.toThrow('boom');
  });

  it('an empty list is not an error', async () => {
    expect(await mapConcurrent([], 4, async () => 1)).toEqual([]);
  });
});
