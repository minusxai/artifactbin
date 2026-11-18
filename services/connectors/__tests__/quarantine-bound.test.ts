/** A quarantined slot does not hold capacity for good: dropped connections whose termination the driver cannot
 * confirm keep their slots only until their reads' own deadlines (plus a grace) have passed, and a slot whose
 * session the driver later confirms gone is released at once. */
import { afterEach, expect, it, vi } from 'vitest';
import { SessionPool } from '../src/sessions';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('reads still succeed after every slot held a dropped connection that termination never confirmed', async () => {
 vi.spyOn(console, 'warn').mockImplementation(() => {});
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
 let opened = 0;
 const pool = new SessionPool<number>({ open: async () => ++opened, close: async () => { throw Error('termination unavailable'); } }, { size: 8, idleMs: 30_000, waitMs: 1000 });
 try {
  // Each read loses its connection: the work fails and the session is discarded, its termination unconfirmed.
  for (let i = 0; i < 8; i++) await expect(pool.use('db', async () => { throw Error('connection lost'); }, { timeoutMs: 1000 })).rejects.toThrow('connection lost');
  expect(pool.count()).toBe(8);
  let early: unknown = 'pending';
  const blocked = pool.use('db', async () => 'ran', { timeoutMs: 50 }).then(value => { early = value; }, error => { early = error; });
  await vi.advanceTimersByTimeAsync(50);
  await blocked;
  expect(early).toMatchObject({ code: 'timeout' });
  // Past the reads' deadlines and the grace, the slots are free again: a read opens a new session and answers.
  await vi.advanceTimersByTimeAsync(10_000);
  expect(pool.count()).toBe(0);
  let late: unknown = 'pending';
  const read = pool.use('db', async session => session, { timeoutMs: 1000 }).then(value => { late = value; });
  await vi.advanceTimersByTimeAsync(1);
  await read;
  expect(late).toBe(9);
 } finally { await pool.close().catch(() => {}); }
});

it('releases a quarantined slot as soon as a retried termination confirms the session is gone', async () => {
 vi.spyOn(console, 'warn').mockImplementation(() => {});
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
 let confirmed = false, closes = 0;
 const pool = new SessionPool<object>({ open: async () => ({}), close: async () => { closes++; if (!confirmed) throw Error('database unreachable'); } }, { size: 1, idleMs: 30_000, waitMs: 60_000 });
 try {
  await expect(pool.use('db', async () => { throw Error('connection lost'); })).rejects.toThrow('connection lost');
  expect(pool.count()).toBe(1);
  // The database answers again: the next retry confirms, long before the read's own deadline.
  confirmed = true;
  await vi.advanceTimersByTimeAsync(2_000);
  expect(closes).toBeGreaterThan(1);
  expect(pool.count()).toBe(0);
 } finally { await pool.close(); }
});
