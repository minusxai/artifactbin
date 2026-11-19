/**
 * CONFIRMED TERMINATION (MySQL protocol): a session the pool retires is killed from a second, control connection on
 * the same account, and counts as gone only when that same connection's `SHOW PROCESSLIST` no longer lists its
 * thread. All of it, the control connection's setup included, runs within one bound (`boundMs`), so the pool's own
 * wait (sessions.ts) outlasts it.
 *
 * Anything less is `ConnectorFailure('unavailable')` with a message that starts with UNCONFIRMED and says which of
 * the three it was, with the facts that tell them apart:
 *  - the control connection failed (opening it, or answering KILL or SHOW PROCESSLIST): the step and the mapped code;
 *  - the bound expired: what it was waiting on;
 *  - the thread was still listed after KILL: that row's Command, State and Time;
 * each with the thread id, the milliseconds since the cleanup began and whether (and how fast) the control
 * connection opened. It never carries a credential, the driver's raw text, or anything of another session; of the
 * thread's own row only Command, State and Time (never Info, User, Host or db).
 */
import { ConnectorFailure, driverFailure } from './errors';
import { withinTime } from './answer';

export const UNCONFIRMED = 'database termination unconfirmed';
/** What the check needs of a control connection: one statement at a time, and a way to drop it. */
export interface ControlConnection { query<T>(text: string): Promise<T>; destroy(): void }
type Row = { Id?: unknown; Command?: unknown; State?: unknown; Time?: unknown };
const field = (value: unknown) => JSON.stringify(String(value ?? '').slice(0, 64));

export async function confirmTermination(threadId: number, open: (timeoutMs: number) => Promise<ControlConnection>,
  { boundMs = 4500, secrets = [] as readonly string[] } = {}): Promise<void> {
  const started = performance.now(), deadline = started + boundMs, elapsed = () => Math.round(performance.now() - started);
  let step = 'opening the control connection', opened: number | null = null, expired = false;
  const unconfirmed = (what: string) => new ConnectorFailure('unavailable', `${UNCONFIRMED}: ${what} (thread ${threadId}, ${elapsed()} ms`
    + ` after the cleanup began, ${opened === null ? 'the control connection never opened' : `the control connection opened in ${opened} ms`})`);
  const failedAt = (error: unknown) => {
    const mapped = driverFailure(error, secrets), errno = (error as { errno?: unknown })?.errno;
    if (mapped.code === 'timeout' && opened === null) return unconfirmed(`the ${boundMs} ms bound expired while ${step}`);
    return unconfirmed(`the control connection failed while ${step} (${mapped.code}${typeof errno === 'number' ? `, errno ${errno}` : ''})`);
  };
  let control: ControlConnection;
  try { control = await open(boundMs); } catch (error) { throw failedAt(error); }
  opened = elapsed();
  try {
    await withinTime(Math.max(1, deadline - performance.now()), undefined, () => { expired = true; control.destroy(); }, async () => {
      // Same-account KILL is followed by server-side absence, never inferred from socket close.
      step = 'running KILL';
      try { await control.query(`KILL CONNECTION ${threadId}`); }
      catch (error) { if ((error as { errno?: number }).errno !== 1094) throw error; }
      step = 'reading SHOW PROCESSLIST';
      const row = (await control.query<Row[]>('SHOW PROCESSLIST')).find(r => Number(r.Id) === threadId);
      if (row) throw unconfirmed(`the thread is still listed after KILL (Command ${field(row.Command)}, State ${field(row.State)}, Time ${Number(row.Time)} s)`);
    });
  } catch (error) {
    if (expired) throw unconfirmed(`the ${boundMs} ms bound expired while ${step}`);
    if (error instanceof ConnectorFailure && error.message.startsWith(UNCONFIRMED)) throw error;
    throw failedAt(error);
  } finally { control.destroy(); }
}
