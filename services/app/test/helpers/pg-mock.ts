/**
 * THE ONE FAKE `pg` CLIENT for the dataset tests that must not reach a database.
 *
 * Two files hand-rolled the same `vi.mock('pg', …)` with the same `Client` class — one recording
 * the options the driver was constructed with, the other counting concurrent connections — and
 * neither could see the other's half. A test needing both would have written a third.
 *
 * Use it from a `vi.mock` factory, with the fixture hoisted so the factory can close over it:
 *
 *   const fixture = vi.hoisted((): PgFixture => ({ active: 0, maximum: 0 }));
 *   vi.mock('pg', async () => (await import('@/test/helpers/pg-mock')).pgModule(fixture));
 */
import type { ClientConfig } from 'pg';

export interface PgFixture {
  /** The options the last `new Client(...)` was given — the whole point for the TLS tests. */
  options?: ClientConfig;
  /** Connections currently open, and the high-water mark, for the pool-bound tests. */
  active: number;
  maximum: number;
  /** When set, `connect()` waits on it — that is how a test holds slots open. */
  blocked?: Promise<void>;
  /** Resolves `blocked`. */
  release?: () => void;
}

/** A fresh fixture with the counters zeroed. Call it from `beforeEach`/`afterEach` to reset. */
export function resetPgFixture(fixture: PgFixture): void {
  fixture.release?.();
  fixture.options = undefined;
  fixture.active = 0;
  fixture.maximum = 0;
  fixture.blocked = undefined;
  fixture.release = undefined;
}

/** The `pg` module shape the driver imports: a default export carrying `types` and `Client`. */
export function pgModule(fixture: PgFixture) {
  return {
    default: {
      types: { getTypeParser: () => (value: unknown) => value },
      Client: class {
        constructor(options: ClientConfig) { fixture.options = options; }
        on() {}
        async connect() {
          fixture.active++;
          fixture.maximum = Math.max(fixture.maximum, fixture.active);
          await fixture.blocked;
        }
        async query() { return { rows: [], fields: [] }; }
        async end() { fixture.active--; }
      },
    },
  };
}
