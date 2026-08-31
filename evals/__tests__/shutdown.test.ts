/**
 * Teardown must not be able to outlive the work.
 *
 * A finished leg once sat for half an hour after its last task printed PASS,
 * because a proxy's `close()` waits for connections and one of them never went
 * away. On CI that is worse than slow: the job hits its timeout, is CANCELLED,
 * and `upload-artifact` never runs — so a run that DID all its work and scored
 * it reports nothing at all. The sockets are the OS's to reclaim once we exit;
 * waiting on them buys nothing.
 */
import { describe, it, expect } from 'vitest';
import { settleWithin } from '../lib/shutdown';

const never = new Promise<void>(() => {});
const after = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('settleWithin', () => {
  it('resolves as soon as the work does, without waiting out the bound', async () => {
    const t = Date.now();
    await settleWithin(after(5), 5000);
    expect(Date.now() - t).toBeLessThan(500);
  });

  it('gives up on work that never finishes, rather than hanging forever', async () => {
    const t = Date.now();
    await expect(settleWithin(never, 50)).resolves.toBeUndefined();
    expect(Date.now() - t).toBeGreaterThanOrEqual(45);
  });

  it('does not reject when the work rejects — teardown failing is not the run failing', async () => {
    await expect(settleWithin(Promise.reject(new Error('socket gone')), 1000)).resolves.toBeUndefined();
  });
});
