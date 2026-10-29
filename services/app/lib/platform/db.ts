/**
 * Database adapter: PGLite (embedded, default) or Postgres — selected by ONE
 * env, `DATABASE_URL`, via scheme dispatch (lib/database-url parseDatabaseUrl).
 *
 * This is the only file that imports @electric-sql/pglite or pg.
 */
import {parseDatabaseUrl,type DbTarget} from './database-url';
export {parseDatabaseUrl} from './database-url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATABASE_URL } from './config';
import { SCHEMA_STATEMENTS } from './schema';
import { recordQuery } from './query-stats';

/**
 * The single database knob, dispatched on scheme — the URL IS the type:
 *   unset/empty      → embedded PGLite in this app package's data/pglite
 *                      directory (zero-config dev, independent of cwd)
 *   pglite://<path>  → embedded PGLite at <path>, taken literally after the
 *                      prefix (relative or absolute); pglite://memory → RAM
 *   anything else    → Postgres, URL handed to pg verbatim — database, user,
 *                      and search_path/schema are the caller's choice; the
 *                      idempotent boot DDL applies to whatever it points at
 */
/**
 * An explicit relative `pglite://` URL belongs to its caller and remains
 * relative to cwd. The implicit zero-config store belongs to the app, though:
 * anchor that one beside the app package so `npm run dev` (cwd services/app)
 * and `npx tsx server.ts` (cwd repo root) cannot silently open two libraries.
 *
 * The root is injectable because the path rule is product behaviour worth
 * testing without making a test depend on where Vitest happens to run.
 */
export function databaseTargetForRuntime(
  url: string | undefined | null,
  appRoot = fileURLToPath(new URL('../..', import.meta.url)),
): DbTarget {
  const target = parseDatabaseUrl(url);
  if ((url ?? '').trim() || target.engine !== 'pglite' || !target.dataDir) return target;
  return { ...target, dataDir: path.resolve(appRoot, 'data/pglite') };
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** Channel names go straight into `LISTEN` (not parameterizable) — allow only safe identifiers. */
function assertSafeChannel(channel: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(channel)) {
    throw new Error(`unsafe NOTIFY channel name: ${channel}`);
  }
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /**
   * Subscribe to Postgres NOTIFYs on `channel`; resolves to an async
   * unsubscribe. NOTIFY is only a wakeup pointer:
   * a missed delivery is harmless because subscribers catch-up SELECT.
   * Emitting needs no API — writes chain `pg_notify` into their own statement.
   *
   * `onLost` fires when the connection holding the LISTEN is gone: no further
   * notification will arrive on this subscription, so the subscriber must
   * drop it and subscribe again (live streams end, and their clients
   * reconnect and catch up). PGLite's embedded connection is never lost.
   */
  listen(channel: string, onNotify: (payload: string) => void, onLost?: () => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
  /**
   * The driver handle, for the ONE other owner of this database in the
   * process: the co-hosted proxy, whose identity tables share
   * a PGLite instance (single-owner) or a pool with the app. Nothing else
   * should reach for it.
   */
  raw(): { kind: 'pglite'; instance: unknown } | { kind: 'pg'; pool: unknown };
}

/**
 * PGLite is a SINGLE embedded connection: concurrent query/transaction calls
 * interleave their wire messages, corrupting the protocol (Postgres 08P01) or
 * cross-binding parameters (22P02). Every operation — including whole
 * transactions — is serialized through a promise chain so exactly one runs at
 * a time. (No throughput cost: PGLite can't parallelize queries anyway.)
 * The Postgres adapter's Pool is concurrency-safe and must NOT be serialized.
 */
class PgliteDb implements Db {
  // PGlite instance — typed loosely so this file compiles without the import
  // being top-level (see createDb for why the import is dynamic).
  private db: {
    query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
    exec(sql: string): Promise<unknown>;
    transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
    listen(channel: string, cb: (payload?: string) => void): Promise<() => Promise<void>>;
    close(): Promise<void>;
    waitReady: Promise<void>;
  };

  private opQueue: Promise<unknown> = Promise.resolve();

  constructor(db: PgliteDb['db']) {
    this.db = db;
  }

  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this.opQueue.then(op, op);
    this.opQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return recordQuery(() => this.serialize(async () => {
      const r = await this.db.query<T>(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    }));
  }

  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    // Serialize the WHOLE transaction so its inner queries can't interleave
    // with other operations on the single connection.
    return this.serialize(() =>
      this.db.transaction(async (pgtx) => {
        const t = pgtx as { query<U>(sql: string, params?: unknown[]): Promise<{ rows: U[]; affectedRows?: number }> };
        const tx: Queryable = {
          query: <U,>(sql: string, params: unknown[] = []) => recordQuery(async () => {
            const r = await t.query<U>(sql, params);
            return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
          }),
        };
        return fn(tx);
      }),
    );
  }

  async initializeSchema(): Promise<void> {
    await this.db.waitReady;
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.serialize(() => this.db.exec(stmt));
    }
  }

  // PGLite delivers notifications through its single embedded connection, so
  // the LISTEN statement is serialized with every other op (the callback fires
  // later, off-queue).
  raw() { return { kind: 'pglite' as const, instance: this.db }; }

  async listen(channel: string, onNotify: (payload: string) => void): Promise<() => Promise<void>> {
    assertSafeChannel(channel);
    const unsubscribe = await this.serialize(() => this.db.listen(channel, (p) => onNotify(p ?? '')));
    return async () => { await this.serialize(() => unsubscribe()); };
  }

  /**
   * THROUGH THE QUEUE, like every other operation — closing was the one that
   * was not, and PGLite hangs when a query is still in flight as the wasm
   * instance goes away. Fire-and-forget telemetry is exactly that case: a
   * `void trackEvent(...)` at the end of a request has its INSERT (and, on the
   * first one, the events writer's DDL) still queued when a test's teardown or
   * a shutdown closes the database. Waiting our turn costs nothing — the queue
   * is already the contract this class states — and it makes `close` mean
   * "after what was asked for", not "now, mid-statement".
   */
  async close(): Promise<void> {
    await this.serialize(() => this.db.close());
  }
}

/** One LISTEN subscriber on the shared Postgres listener connection. */
interface ChannelListener { notify: (payload: string) => void; lost?: () => void }

export class PostgresDb implements Db {
  private pool: {
    query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
    connect(): Promise<{
      query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
      on(event: string, cb: (arg: { channel: string; payload?: string }) => void): void;
      /** `true` destroys the connection instead of returning it to the pool. */
      release(destroy?: boolean): void;
    }>;
    end(): Promise<void>;
  };

  // ONE dedicated client holds every LISTEN for this process and fans NOTIFYs
  // out in memory to per-channel handler sets — one connection, not one per
  // subscriber, so the pool stays free.
  private listenClient: Awaited<ReturnType<PostgresDb['pool']['connect']>> | null = null;
  private listenSetup: Promise<Awaited<ReturnType<PostgresDb['pool']['connect']>>> | null = null;
  private channelHandlers = new Map<string, Set<ChannelListener>>();

  constructor(pool: PostgresDb['pool']) {
    this.pool = pool;
  }

  query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return recordQuery(async () => {
      const r = await this.pool.query<T>(sql, params);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    });
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Queryable = {
        query: <U,>(sql: string, params: unknown[] = []) => recordQuery(async () => {
          const r = await client.query<U>(sql, params);
          return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
        }),
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }


  /**
   * Lazily acquire the shared listener client and wire its notification dispatch.
   *
   * RE-ESTABLISHED ON DEMAND: when the connection is lost (a Postgres restart
   * or failover, an idle-connection reaper, a network blip) every subscriber
   * is told (`onLost`) and the registry is emptied, so the next `listen()`
   * acquires a fresh client and re-issues LISTEN. The live streams end on that
   * signal and their clients reconnect with backoff, which paces the relisten;
   * a failed acquire is not cached, so the next attempt tries again.
   */
  private getListenClient(): Promise<Awaited<ReturnType<PostgresDb['pool']['connect']>>> {
    if (this.listenClient) return Promise.resolve(this.listenClient);
    if (this.listenSetup) return this.listenSetup;
    const setup = (async () => {
      const client = await this.pool.connect();
      client.on('notification', (msg) => {
        if (this.listenClient !== client) return;
        for (const h of [...(this.channelHandlers.get(msg.channel) ?? [])]) h.notify(msg.payload ?? '');
      });
      let lost = false;
      const reset = () => {
        if (lost) return;
        lost = true;
        if (this.listenClient !== client) return;
        this.listenClient = null;
        this.listenSetup = null;
        const orphaned = [...this.channelHandlers.values()].flatMap((set) => [...set]);
        this.channelHandlers.clear();
        // Destroy rather than return it: a broken client must not go back to the pool, and a leaked
        // checked-out one would cost a pool slot on every loss.
        try { client.release(true); } catch { /* already released */ }
        for (const listener of orphaned) {
          try { listener.lost?.(); } catch { /* one subscriber must not stop the others hearing */ }
        }
      };
      client.on('error', reset);
      client.on('end', reset);
      this.listenClient = client;
      return client;
    })();
    this.listenSetup = setup;
    setup.catch(() => { if (this.listenSetup === setup) this.listenSetup = null; });
    return setup;
  }

  raw() { return { kind: 'pg' as const, pool: this.pool }; }

  async listen(channel: string, onNotify: (payload: string) => void, onLost?: () => void): Promise<() => Promise<void>> {
    assertSafeChannel(channel);
    const client = await this.getListenClient();
    const listener: ChannelListener = { notify: onNotify, lost: onLost };
    let handlers = this.channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channelHandlers.set(channel, handlers);
      try {
        await client.query(`LISTEN "${channel}"`);
      } catch (error) {
        if (this.channelHandlers.get(channel) === handlers && handlers.size === 0) this.channelHandlers.delete(channel);
        throw error;
      }
    }
    // Lost between acquiring the client and registering: refuse, rather than hold a subscription that never hears.
    if (this.listenClient !== client) throw new Error('listener connection lost');
    handlers.add(listener);

    return async () => {
      const set = this.channelHandlers.get(channel);
      if (!set || !set.delete(listener)) return;
      if (set.size === 0) {
        this.channelHandlers.delete(channel);
        try { await this.listenClient?.query(`UNLISTEN "${channel}"`); } catch { /* connection gone */ }
      }
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Return TIMESTAMP/TIMESTAMPTZ as ISO strings, not Date objects, and keep the
// wire shape identical between the two adapters.
const TIMESTAMPTZ_OID = 1184;
const TIMESTAMP_OID = 1114;
const toIso = (v: string) => new Date(v).toISOString();

/**
 * The serving pool's bounds. A request that waits 5 s for a connection fails instead of queueing behind
 * the proxy's 30 s deadline, and one runaway statement is cancelled instead of holding its connection for good.
 */
export const SERVING_POOL = {
  max: 20,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 60_000,
  // A request that dies mid-transaction must not hold its row locks and connection; a statement stuck behind a lock gives up.
  idle_in_transaction_session_timeout: 30_000,
  lock_timeout: 10_000,
} as const;

/**
 * An idle client's error (a database restart or failover) is emitted on the pool; with no listener Node
 * throws it and the process exits. The pool has already discarded that client, so logging is enough.
 */
/** Shared with the server's extensions, whose boot DDL takes the same lock. */
export const SCHEMA_LOCK = 'artifactbin.app.schema';

export function withPoolErrors<P extends { on(event: 'error', cb: (error: Error) => void): unknown }>(pool: P): P {
  pool.on('error', (error) => console.error('[db] idle connection lost:', error.message));
  return pool;
}

/**
 * A prepared in-memory database: the schema a fresh in-memory PGLite would build, dumped once and restored by
 * every later one in the process instead of re-running the DDL and backfills.
 */
export interface SchemaImage {
  load(): Blob | File | undefined;
  save(image: Blob | File): void;
}

/** How `getDb` opens the database when a composition root decides rather than `DATABASE_URL`. */
export interface DbOptions {
  /** The database to open; `DATABASE_URL` (databaseTargetForRuntime) when absent. */
  target?: DbTarget;
  /** Used only for in-memory PGLite. */
  schemaImage?: SchemaImage;
}

/**
 * Composition seam, for a process that owns its databases (the test harness: one in-memory PGLite per file, each
 * restored from a schema image, whatever the ambient DATABASE_URL says). Takes effect at the next open (after
 * `resetDb`). Kept on the process global, like the open database, so a module reload keeps it.
 */
export function configureDb(options: DbOptions | undefined): void {
  global.__artifact_bin_db_options__ = options;
}

async function createDb(): Promise<Db> {
  const options = global.__artifact_bin_db_options__ ?? {};
  const target = options.target ?? databaseTargetForRuntime(DATABASE_URL);

  // Intentional dynamic imports load only the selected database engine.
  if (target.engine === 'pg') {
    const pg = await import('pg');
    pg.types.setTypeParser(TIMESTAMPTZ_OID, toIso);
    pg.types.setTypeParser(TIMESTAMP_OID, (v: string) => toIso(v.replace(' ', 'T') + 'Z'));
    // The boot DDL and backfills run on their own short-lived connection, with no statement timeout: an index
    // build on a large table may outlast the request bound the serving pool below holds every statement to.
    // ONE BOOT AT A TIME. Replicas booting together would race `CREATE … IF NOT EXISTS` (not concurrency-safe in
    // Postgres: the loser fails on the catalog's unique index), so the session advisory lock serialises them. Each
    // statement still commits on its own, keeping the table locks it takes as short as before.
    const boot = withPoolErrors(new pg.Client({ connectionString: target.url }));
    await boot.connect();
    try {
      await boot.query(`SELECT pg_advisory_lock(hashtext('${SCHEMA_LOCK}'))`);
      for (const stmt of SCHEMA_STATEMENTS) await boot.query(stmt);
      await applyBackfills(boot);
    } finally {
      await boot.end();
    }
    return new PostgresDb(withPoolErrors(new pg.Pool({ connectionString: target.url, ...SERVING_POOL })));
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const parsers = {
    [TIMESTAMP_OID]: (v: string) => v.replace(' ', 'T') + 'Z',
    [TIMESTAMPTZ_OID]: toIso,
  };
  if (target.dataDir) {
    // PGLite's own mkdir is not recursive — it fails when the parent
    // directory (e.g. ./data) doesn't exist yet.
    const { mkdirSync } = await import('fs');
    mkdirSync(target.dataDir, { recursive: true });
  }
  const image = target.dataDir ? undefined : options.schemaImage;
  const snapshot = image?.load();
  const raw = target.dataDir ? new PGlite(target.dataDir, { parsers })
    : new PGlite(snapshot ? { parsers, loadDataDir: snapshot } : { parsers });
  const db = new PgliteDb(raw as unknown as ConstructorParameters<typeof PgliteDb>[0]);
  if (snapshot) {
    await raw.waitReady;
    return db;
  }
  await db.initializeSchema();
  await applyBackfills(db);
  if (image) image.save(await raw.dumpDataDir('none'));
  return db;
}

/**
 * The DATA half of the boot migration, beside the DDL half: statements that
 * move existing rows onto a new shape, idempotent, run on every start. The open
 * adapter is handed in because `getDb()` would wait on the promise this very
 * call resolves.
 */
async function applyBackfills(db: Queryable): Promise<void> {
  // Existing likes/follows predate lifecycle fields. Membership has no legacy migration.
  await db.query("UPDATE relations SET initiated_by=coalesce(initiated_by,subject_id),accepted_at=coalesce(accepted_at,created_at),status=CASE WHEN deleted_at IS NULL THEN status ELSE 'left' END WHERE verb IN ('like','follow') AND initiated_by IS NULL");
}

/**
 * Cache the in-flight adapter promise on the process global so concurrent calls
 * and module reloads share one connection to the database directory.
 */
declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_db__: Promise<Db> | undefined;
  // eslint-disable-next-line no-var
  var __artifact_bin_db_options__: DbOptions | undefined;
}

export function getDb(): Promise<Db> {
  if (!global.__artifact_bin_db__) {
    const promise = createDb();
    // Drop a rejected promise so the next call retries instead of permanently
    // serving the failure.
    promise.catch(() => {
      if (global.__artifact_bin_db__ === promise) global.__artifact_bin_db__ = undefined;
    });
    global.__artifact_bin_db__ = promise;
  }
  return global.__artifact_bin_db__;
}

/** Test hook — closes and forgets the cached instance. */
export async function resetDb(): Promise<void> {
  const promise = global.__artifact_bin_db__;
  global.__artifact_bin_db__ = undefined;
  if (promise) {
    try {
      await (await promise).close();
    } catch {
      /* ignore — may already be closed */
    }
  }
}
