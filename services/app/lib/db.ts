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
import { DATABASE_URL, IS_TEST } from './config';
import { SCHEMA_STATEMENTS } from './schema';

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
  appRoot = fileURLToPath(new URL('..', import.meta.url)),
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
   */
  listen(channel: string, onNotify: (payload: string) => void): Promise<() => Promise<void>>;
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
    return this.serialize(async () => {
      const r = await this.db.query<T>(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    });
  }

  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    // Serialize the WHOLE transaction so its inner queries can't interleave
    // with other operations on the single connection.
    return this.serialize(() =>
      this.db.transaction(async (pgtx) => {
        const t = pgtx as { query<U>(sql: string, params?: unknown[]): Promise<{ rows: U[]; affectedRows?: number }> };
        const tx: Queryable = {
          query: async <U,>(sql: string, params: unknown[] = []) => {
            const r = await t.query<U>(sql, params);
            return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
          },
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

class PostgresDb implements Db {
  private pool: {
    query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
    connect(): Promise<{
      query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
      on(event: string, cb: (arg: { channel: string; payload?: string }) => void): void;
      release(): void;
    }>;
    end(): Promise<void>;
  };

  // ONE dedicated client holds every LISTEN for this process and fans NOTIFYs
  // out in memory to per-channel handler sets — one connection, not one per
  // subscriber, so the pool stays free.
  private listenClient: Awaited<ReturnType<PostgresDb['pool']['connect']>> | null = null;
  private listenSetup: Promise<Awaited<ReturnType<PostgresDb['pool']['connect']>>> | null = null;
  private channelHandlers = new Map<string, Set<(payload: string) => void>>();

  constructor(pool: PostgresDb['pool']) {
    this.pool = pool;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pool.query<T>(sql, params);
    return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Queryable = {
        query: async <U,>(sql: string, params: unknown[] = []) => {
          const r = await client.query<U>(sql, params);
          return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
        },
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

  async initializeSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.pool.query(stmt);
    }
  }

  /** Lazily acquire the shared listener client and wire its notification dispatch. */
  private getListenClient(): Promise<Awaited<ReturnType<PostgresDb['pool']['connect']>>> {
    if (this.listenClient) return Promise.resolve(this.listenClient);
    if (this.listenSetup) return this.listenSetup;
    this.listenSetup = (async () => {
      const client = await this.pool.connect();
      client.on('notification', (msg) => {
        for (const h of this.channelHandlers.get(msg.channel) ?? []) h(msg.payload ?? '');
      });
      // On connection loss drop it, so the next listen() acquires a fresh
      // client and re-issues LISTEN. Subscribers re-sync by catch-up SELECT.
      const reset = () => {
        if (this.listenClient === client) { this.listenClient = null; this.listenSetup = null; }
        this.channelHandlers.clear();
      };
      client.on('error', reset);
      client.on('end', reset);
      this.listenClient = client;
      return client;
    })();
    return this.listenSetup;
  }

  raw() { return { kind: 'pg' as const, pool: this.pool }; }

  async listen(channel: string, onNotify: (payload: string) => void): Promise<() => Promise<void>> {
    assertSafeChannel(channel);
    const client = await this.getListenClient();
    let handlers = this.channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channelHandlers.set(channel, handlers);
      await client.query(`LISTEN "${channel}"`);
    }
    handlers.add(onNotify);

    return async () => {
      const set = this.channelHandlers.get(channel);
      if (!set) return;
      set.delete(onNotify);
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

async function createDb(): Promise<Db> {
  // Tests always run in-memory PGLite so they never touch a data dir or a
  // real server, whatever the ambient DATABASE_URL says.
  const target = IS_TEST ? ({ engine: 'pglite', dataDir: null } as const) : databaseTargetForRuntime(DATABASE_URL);

  // Intentional dynamic imports load only the selected database engine.
  if (target.engine === 'pg') {
    const pg = await import('pg');
    pg.types.setTypeParser(TIMESTAMPTZ_OID, toIso);
    pg.types.setTypeParser(TIMESTAMP_OID, (v: string) => toIso(v.replace(' ', 'T') + 'Z'));
    const db = new PostgresDb(new pg.Pool({ connectionString: target.url }));
    await db.initializeSchema();
    await applyBackfills(db);
    return db;
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
  const raw = target.dataDir ? new PGlite(target.dataDir, { parsers }) : new PGlite({ parsers });
  const db = new PgliteDb(raw as unknown as ConstructorParameters<typeof PgliteDb>[0]);
  await db.initializeSchema();
  await applyBackfills(db);
  return db;
}

/**
 * The DATA half of the boot migration, beside the DDL half: statements that
 * move existing rows onto a new shape, idempotent, run on every start.
 *
 * `lib/testusers` is reached by a DYNAMIC import, and it is the one exception
 * to top-level imports in this file: that module reads the schema and mints
 * tokens, both of which reach the database, so importing it at the top would
 * close a cycle through the module that is being constructed here. The open
 * adapter is handed in for the same reason — `getDb()` would wait on the
 * promise this very call resolves.
 */
async function applyBackfills(db: Db): Promise<void> {
  const { backfillUserKinds } = await import('./testusers');
  await backfillUserKinds(db);
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
