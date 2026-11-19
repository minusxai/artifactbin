/** An unconfirmed MySQL termination says which of its three causes it was (../src/termination): the thread still
 * listed, the bound expired, or the control connection failed, with the facts and none of another session's, and
 * the pool keeps that account in the error `close()` rejects with and in its log line. */
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectorFailure } from '../src/errors';
import { SessionPool } from '../src/sessions';
import { confirmTermination, type ControlConnection } from '../src/termination';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const OTHER = { Id: 8, User: 'reader', Host: '10.0.0.9:5000', db: 'shop', Command: 'Query', Time: 3, State: 'executing', Info: 'select secret_column from payroll' };
/** A control connection answering each statement with `answer` (a value, a thrown error, or a promise). */
function control(answer: (text: string) => unknown, log: string[] = []): ControlConnection & { destroyed: number } {
  const c = { destroyed: 0, destroy() { c.destroyed++; }, async query<T>(text: string) { log.push(text); return await answer(text) as T; } };
  return c;
}
const failure = (promise: Promise<unknown>) => promise.then(() => { throw Error('expected a rejection'); }, (error: unknown) => error as ConnectorFailure);

it('confirms only when the same control connection no longer lists the thread, and drops that connection', async () => {
  const log: string[] = [], c = control(text => text === 'SHOW PROCESSLIST' ? [OTHER] : [], log);
  let openedWith = 0;
  await confirmTermination(42, async ms => { openedWith = ms; return c; }, { boundMs: 4500 });
  expect(log).toEqual(['KILL CONNECTION 42', 'SHOW PROCESSLIST']);
  expect(openedWith).toBe(4500);expect(c.destroyed).toBe(1);
  // Already gone (1094, unknown thread) is gone.
  await confirmTermination(42, async () => control(text => { if (text.startsWith('KILL')) throw Object.assign(Error('Unknown thread id: 42'), { errno: 1094 }); return []; }));
});

it('waits for MySQL to delist a killed thread: KILL returns before the thread itself leaves SHOW PROCESSLIST', async () => {
  // The killed thread clears its own listing when it next runs, so the first reads after KILL can still list it.
  const log: string[] = [], killed = { ...OTHER, Id: 42, Command: 'Killed', State: 'executing', Time: 0 };
  let reads = 0;
  const c = control(text => text === 'SHOW PROCESSLIST' ? (++reads <= 3 ? [OTHER, killed] : [OTHER]) : [], log);
  await confirmTermination(42, async () => c, { boundMs: 4500 });
  expect(log).toEqual(['KILL CONNECTION 42', 'SHOW PROCESSLIST', 'SHOW PROCESSLIST', 'SHOW PROCESSLIST', 'SHOW PROCESSLIST']);
  expect(c.destroyed).toBe(1);
});

it('says the thread was still listed after KILL, with the last row\'s Command, State and Time and nothing of any session\'s text', async () => {
  // Fake clocks: the paced reads and the elapsed time they report are exact.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let reads = 0;
  const c = control(text => text === 'SHOW PROCESSLIST' ? [OTHER, { ...OTHER, Id: 42, Command: 'Killed', State: ++reads > 1 ? 'cleaning up' : 'executing', Time: 1, Info: 'select hidden from private_table' }] : []);
  const pending = failure(confirmTermination(42, async () => c, { boundMs: 200, secrets: ['owner-pass'] }));
  await vi.advanceTimersByTimeAsync(200);
  const error = await pending;
  // A read every 20 ms until the next would pass the one bound: ten, the last at 180 ms.
  expect(error).toBeInstanceOf(ConnectorFailure);expect(error.code).toBe('unavailable');
  expect(error.message).toBe('database termination unconfirmed: the thread is still listed after KILL in 10 reads (Command "Killed", State "cleaning up", Time 1 s) (thread 42, 180 ms after the cleanup began, the control connection opened in 0 ms)');
  for (const hidden of ['secret_column', 'hidden', 'private_table', 'reader', '10.0.0.9', 'shop']) expect(error.message).not.toContain(hidden);
  expect(c.destroyed).toBeGreaterThan(0);
});

it('says the bound expired and what it was waiting on, whether opening the control connection or after it', async () => {
  // Fake clocks: the bound and the elapsed time it reports are exact.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  try {
    const stalled = control(text => text.startsWith('KILL') ? new Promise(() => {}) : []);
    const pending = failure(confirmTermination(42, async () => stalled, { boundMs: 40 }));
    await vi.advanceTimersByTimeAsync(40);
    const waited = await pending;
    expect(waited).toBeInstanceOf(ConnectorFailure);expect(waited.code).toBe('unavailable');
    expect(waited.message).toBe('database termination unconfirmed: the 40 ms bound expired while running KILL (thread 42, 40 ms after the cleanup began, the control connection opened in 0 ms)');
    expect(stalled.destroyed).toBeGreaterThan(0);
  } finally { vi.useRealTimers(); }
  const listing = control(text => text === 'SHOW PROCESSLIST' ? new Promise(() => {}) : []);
  expect((await failure(confirmTermination(42, async () => listing, { boundMs: 40 }))).message).toContain('expired while reading SHOW PROCESSLIST');
  // The connection's own setup counts against the same bound: one that times out opening says so.
  const opening = await failure(confirmTermination(42, async () => { throw new ConnectorFailure('timeout', 'the query ran past its time limit'); }, { boundMs: 40 }));
  expect(opening.code).toBe('unavailable');
  expect(opening.message).toMatch(/^database termination unconfirmed: the 40 ms bound expired while opening the control connection \(thread 42, \d+ ms after the cleanup began, the control connection never opened\)$/);
});

it('says the control connection failed, at which step and with which code, never the driver\'s text or a secret', async () => {
  const refused = await failure(confirmTermination(42, async () => { throw Object.assign(Error('connect ECONNREFUSED 10.1.2.3:3306 owner-pass'), { code: 'ECONNREFUSED' }); }, { secrets: ['owner-pass'] }));
  expect(refused).toBeInstanceOf(ConnectorFailure);expect(refused.code).toBe('unavailable');
  expect(refused.message).toMatch(/^database termination unconfirmed: the control connection failed while opening the control connection \(connect_failed\) \(thread 42, \d+ ms after the cleanup began, the control connection never opened\)$/);
  const lost = control(text => { if (text === 'SHOW PROCESSLIST') throw Object.assign(Error('Connection lost: owner-pass select secret'), { code: 'PROTOCOL_CONNECTION_LOST' }); return []; });
  const during = await failure(confirmTermination(42, async () => lost, { secrets: ['owner-pass'] }));
  expect(during.message).toMatch(/^database termination unconfirmed: the control connection failed while reading SHOW PROCESSLIST \(connect_failed\) \(thread 42, \d+ ms after the cleanup began, the control connection opened in \d+ ms\)$/);
  const denied = control(text => { if (text.startsWith('KILL')) throw Object.assign(Error('You are not owner of thread 42'), { errno: 1095, sqlState: 'HY000', sqlMessage: 'You are not owner of thread 42' }); return []; });
  expect((await failure(confirmTermination(42, async () => denied))).message).toContain('failed while running KILL (database_error, errno 1095)');
  for (const error of [refused, during]) for (const hidden of ['owner-pass', '10.1.2.3', 'secret']) expect(error.message).not.toContain(hidden);
  expect(lost.destroyed).toBe(1);
});

it('keeps the driver\'s account in what close() rejects with and in the quarantine log line, with the same code and type', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const reason = 'database termination unconfirmed: the thread is still listed after KILL in 1 read (Command "Killed", State "", Time 0 s) (thread 7, 3 ms after the cleanup began, the control connection opened in 2 ms)';
  let confirmed = false;
  const pool = new SessionPool<object>({ open: async () => ({}), close: async () => { if (!confirmed) throw new ConnectorFailure('unavailable', reason); } }, { size: 1, idleMs: 30_000, waitMs: 1000 });
  await expect(pool.use('db', async (_, discard) => { discard(); return 'answer'; })).resolves.toBe('answer');
  const line = String(warn.mock.calls[0]![0]);
  expect(line).toMatch(/^\[connectors\] session termination unconfirmed; its slot stays quarantined \{/);
  expect(JSON.parse(line.slice(line.indexOf('{')))).toMatchObject({ reason, sessions: 1, size: 1 });
  const closed = await failure(pool.close());
  expect(closed).toBeInstanceOf(ConnectorFailure);expect(closed.code).toBe('unavailable');expect(closed.message).toBe(reason);
  // Any other failure says only its code.
  const other = new SessionPool<object>({ open: async () => ({}), close: async () => { throw Error('socket hang up at 10.1.2.3'); } }, { size: 1, idleMs: 30_000, waitMs: 1000 });
  await other.use('db', async () => {});
  const plain = await failure(other.close());
  expect(plain.code).toBe('unavailable');expect(plain.message).toBe('database termination unconfirmed: the driver\'s close failed (not a connector error)');
  confirmed = true;
});
