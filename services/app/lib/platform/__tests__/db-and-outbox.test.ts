/**
 * lib/platform's database and event log, through its index: the URL dispatch, the Postgres adapter's statement
 * accounting, transactions and LISTEN sharing (over a fake pool), the shared in-memory database and its schema, and
 * the outbox a source action commits its facts to and the publisher that drains it.
 */
// harness-exempt: reset lib/platform's own resetDb and configureDb are the subject: the shared adapter reopens after a reset (last test in the file)
import type { EventEnvelope, EventsService } from '@artifactbin/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import {
  PostgresDb, SCHEMA_STATEMENTS, TABLES, databaseTargetForRuntime, enqueueEvent, enqueueEvents, envelope, getDb, measureQueries,
  parseDatabaseUrl, recordEvent, resetDb, services, setEventProjection, setServices, startEventPublisher,
} from '@/lib/platform';
import { SCHEMA_LOCK, configureDb } from '@/lib/platform/db';

const harness = useAppHarness();

describe('the database URL', () => {
  it('is the engine: unset is the default PGLite, pglite:// a path or memory, anything else Postgres verbatim', () => {
    expect(parseDatabaseUrl(undefined)).toEqual({ engine: 'pglite', dataDir: './data/pglite' });
    expect(parseDatabaseUrl('  ')).toEqual({ engine: 'pglite', dataDir: './data/pglite' });
    expect(parseDatabaseUrl('pglite://memory')).toEqual({ engine: 'pglite', dataDir: null });
    expect(parseDatabaseUrl('pglite://')).toEqual({ engine: 'pglite', dataDir: null });
    expect(parseDatabaseUrl('pglite:///var/db')).toEqual({ engine: 'pglite', dataDir: '/var/db' });
    expect(parseDatabaseUrl(' postgres://u@h/db ')).toEqual({ engine: 'pg', url: 'postgres://u@h/db' });
  });

  it('anchors only the default PGLite directory at the app root', () => {
    expect(databaseTargetForRuntime(undefined, '/srv/app')).toEqual({ engine: 'pglite', dataDir: '/srv/app/data/pglite' });
    expect(databaseTargetForRuntime('pglite://rel/dir', '/srv/app')).toEqual({ engine: 'pglite', dataDir: 'rel/dir' });
    expect(databaseTargetForRuntime('pglite://memory', '/srv/app')).toEqual({ engine: 'pglite', dataDir: null });
    expect(databaseTargetForRuntime('postgres://h/db', '/srv/app')).toEqual({ engine: 'pg', url: 'postgres://h/db' });
  });
});

/** A pg pool double: records statements, and hands out one client whose events the test can fire. */
function fakePool(fail?: (sql: string) => boolean) {
  const statements: string[] = [];
  const handlers = new Map<string, ((arg: never) => void)[]>();
  const released: (boolean | undefined)[] = [];
  const run = async (sql: string) => {
    statements.push(sql);
    if (fail?.(sql)) throw new Error(`failed: ${sql}`);
    return { rows: [{ sql }], rowCount: null };
  };
  const client = {
    query: run,
    on: (event: string, cb: (arg: never) => void) => { handlers.set(event, [...handlers.get(event) ?? [], cb]); },
    release: (destroy?: boolean) => { released.push(destroy); },
  };
  const pool = { query: run, connect: vi.fn(async () => client), end: vi.fn(async () => {}) };
  const fire = (event: string, arg?: unknown) => { for (const cb of handlers.get(event) ?? []) cb(arg as never); };
  return { pool: pool as unknown as ConstructorParameters<typeof PostgresDb>[0], statements, released, fire, connect: pool.connect, end: pool.end };
}

describe('the Postgres adapter', () => {
  it('answers rows with a row count, and counts statements into every active measure', async () => {
    const fake = fakePool(), db = new PostgresDb(fake.pool);
    const { value, stats } = await measureQueries(async () => {
      const inner = await measureQueries(() => db.query('SELECT 1'));
      expect(inner.stats.count).toBe(1);
      return db.query('SELECT 2');
    });
    expect(value).toEqual({ rows: [{ sql: 'SELECT 2' }], rowCount: 1 });
    expect(stats.count).toBe(2);
    expect(stats.ms).toBeGreaterThanOrEqual(0);
    expect(db.raw()).toEqual({ kind: 'pg', pool: fake.pool });
    await db.close();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it('commits a transaction that returns and rolls back one that throws, releasing the client both times', async () => {
    const fake = fakePool(sql => sql === 'BAD'), db = new PostgresDb(fake.pool);
    await expect(db.transaction(async tx => (await tx.query('GOOD')).rowCount)).resolves.toBe(1);
    await expect(db.transaction(tx => tx.query('BAD'))).rejects.toThrow('failed: BAD');
    expect(fake.statements).toEqual(['BEGIN', 'GOOD', 'COMMIT', 'BEGIN', 'BAD', 'ROLLBACK']);
    expect(fake.released).toEqual([undefined, undefined]);
  });

  it('holds every LISTEN on one connection, fans notifications out, and unlistens with the last subscriber', async () => {
    const fake = fakePool(), db = new PostgresDb(fake.pool);
    const a = vi.fn(), b = vi.fn();
    const stopA = await db.listen('artifact_changes', a);
    const stopB = await db.listen('artifact_changes', b);
    expect(fake.connect).toHaveBeenCalledOnce();
    fake.fire('notification', { channel: 'artifact_changes', payload: 'x1' });
    fake.fire('notification', { channel: 'other', payload: 'x2' });
    expect(a).toHaveBeenCalledWith('x1');
    expect(b).toHaveBeenCalledWith('x1');
    expect(a).toHaveBeenCalledOnce();
    await stopA();
    await stopA();
    expect(fake.statements.filter(s => s.startsWith('UNLISTEN'))).toEqual([]);
    await stopB();
    expect(fake.statements).toEqual(['LISTEN "artifact_changes"', 'UNLISTEN "artifact_changes"']);
  });

  it('tells every subscriber when the listening connection is lost, then opens a new one', async () => {
    const fake = fakePool(), db = new PostgresDb(fake.pool);
    const lost = vi.fn();
    await db.listen('one', () => {}, lost);
    await db.listen('two', () => {}, () => { throw new Error('a failing subscriber does not stop the others'); });
    fake.fire('error', new Error('connection reset'));
    fake.fire('end');
    expect(lost).toHaveBeenCalledOnce();
    expect(fake.released).toEqual([true]);
    await db.listen('one', () => {});
    expect(fake.connect).toHaveBeenCalledTimes(2);
  });

  it('refuses a channel name it would have to quote', async () => {
    const fake = fakePool(), db = new PostgresDb(fake.pool);
    await expect(db.listen('bad"; DROP TABLE users; --', () => {})).rejects.toThrow();
    expect(fake.statements).toEqual([]);
  });
});

describe('the shared database', () => {
  it('is one adapter per process until reset, built from the full schema', async () => {
    const db = await getDb();
    expect(await getDb()).toBe(db);
    const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(r => r.table_name);
    for (const table of TABLES) expect(tables).toContain(table.name);
    expect(SCHEMA_STATEMENTS.filter(s => s.startsWith('CREATE TABLE')).length).toBe(TABLES.length);
    expect(SCHEMA_LOCK).toBe('artifactbin.app.schema');
  });

});

describe('the event outbox', () => {
  const projection = globalThis.__artifact_bin_event_projection__;
  afterEach(() => { if (projection) setEventProjection(projection); setServices({ events: services().events }); });
  const event = (id: string): EventEnvelope => ({ ...envelope(null, 'created', { kind: 'artifact', id }, {} as never), id });
  const outbox = async () => (await (await getDb()).query<{ id: string }>('SELECT id FROM event_outbox ORDER BY created_at,id')).rows.map(r => r.id);

  it('enqueues an envelope once, and many in one statement in order', async () => {
    const db = await harness.db();
    await enqueueEvent(db, event('e1'));
    await enqueueEvent(db, event('e1'));
    await enqueueEvents(db, []);
    await enqueueEvents(db, [event('e2'), event('e3'), event('e1')]);
    expect((await outbox()).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('records a fact with its projection in the same transaction, and refuses without a projection', async () => {
    const db = await harness.db();
    const projected: string[] = [];
    setEventProjection(async (_tx, e) => { projected.push(e.verb); });
    await db.transaction(tx => recordEvent(tx, null, 'created', { kind: 'artifact', id: 'doc1' }, {} as never));
    expect(projected).toEqual(['created']);
    expect(await outbox()).toHaveLength(1);
    setEventProjection(async () => { throw new Error('projection failed'); });
    await expect(db.transaction(tx => recordEvent(tx, null, 'created', { kind: 'artifact', id: 'doc2' }, {} as never))).rejects.toThrow('projection failed');
    expect(await outbox()).toHaveLength(1);
    globalThis.__artifact_bin_event_projection__ = undefined;
    await expect(recordEvent(db, null, 'created', { kind: 'artifact', id: 'doc3' }, {} as never)).rejects.toThrow('event_projection_unregistered');
  });

  it('publishes the outbox and deletes what was published, keeping rows a failed publish could not deliver', async () => {
    const db = await harness.db();
    await enqueueEvents(db, [event('p1'), event('p2')]);
    let fail = true;
    const published: string[] = [];
    const publish = vi.fn(async (events: EventEnvelope[]) => { if (fail) throw new Error('events service down'); published.push(...events.map(e => e.id)); });
    setServices({ events: { ...services().events, publish } as EventsService });
    const stop = startEventPublisher(db);
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    expect((await outbox()).sort()).toEqual(['p1', 'p2']);
    fail = false;
    await stop();
    expect(published.sort()).toEqual(['p1', 'p2']);
    expect(await outbox()).toEqual([]);
  });
});

/** Last in the file: it closes the adapter the harness opened. */
describe('a reset', () => {
  it('opens a new adapter after reset, with the options a composition root configured', async () => {
    const before = await getDb();
    configureDb(globalThis.__artifact_bin_db_options__);
    await resetDb();
    const after = await getDb();
    expect(after).not.toBe(before);
    expect((await after.query<{ n: number }>('SELECT 1 AS n')).rows).toEqual([{ n: 1 }]);
  });
});
