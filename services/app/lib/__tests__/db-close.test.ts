/**
 * CLOSING IS AN OPERATION, so it waits in the same queue as every other one.
 *
 * PGLite is a single embedded connection and `PgliteDb` serializes everything
 * through one promise chain; `close` was the exception, and it took the wasm
 * instance away while a statement was still in flight. Fire-and-forget
 * telemetry is exactly the caller that loses that race: a `void trackEvent(...)`
 * at the end of a request, or the events writer's DDL on its first emit, is
 * still queued when a teardown or a shutdown closes the database.
 *
 * HOW THIS ONE GOES RED: revert `close` to `await this.db.close()` and the test
 * HANGS rather than failing an assertion — the abandoned statement leaves the
 * wasm instance spinning at 100%, which starves the event loop, so no in-process
 * timer can turn it into a fast failure. Run it under a wall-clock cap.
 */
// harness-exempt: reset closing the database, and the global handle it leaves behind, IS the subject here
import { afterAll, describe, expect, it } from 'vitest';
import { getDb, resetDb } from '../db';

afterAll(() => resetDb());

describe('closing the embedded database', () => {
  it('waits for what is already queued — an unawaited query still settles', async () => {
    const db = await getDb();
    // Unawaited, exactly as `void trackEvent(...)` fires it, and slow enough
    // that the close below is asked for while it is still running.
    const pending = db.query<{ n: number }>('SELECT pg_sleep(0.3), 1 AS n');
    const started = Date.now();
    await db.close();
    // The close was ASKED FOR mid-statement and waited for it: a close that
    // returned at once would be back well inside the sleep.
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect((await pending).rows[0]!.n).toBe(1);
  });
});
