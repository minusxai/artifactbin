/**
 * PREPARED CATALOG DATABASES: a catalog read whose every stored source carries a content `key` is
 * answered from a database already built for exactly that catalog and those keys, so a repeated read
 * neither ships its rows again nor rebuilds SQLite. The caller sends the keys alone first; a miss is a
 * `rowsRequired` failure and the caller resends with the rows (services/app/lib/datasets/execute.ts is that caller).
 * Each read runs in a transaction that is rolled back, so a kept database stays as built, and the worker pool sends a
 * keyed read to the thread its database was last sent to when that thread is idle (`SqlPoolOptions.preparedBytes`,
 * 32 MiB per thread by default, is the cap).
 *
 * The entry's identity is derived HERE from everything the database mounts — the default schema, every
 * table's schema, name and columns, every model's SQL and every source's key — never from a caller's key
 * alone: a role view that hides a column, filters rows or empties a model mounts another database, so it
 * can never read one built for another view. A key is a content address (the rows behind it never
 * change), so nothing is ever invalidated: a write makes a new key and the old entry ages out.
 *
 * Byte-capped LRU, per thread: the size of an entry is its pages, measured after the build. A database
 * larger than the whole cap answers its read once and is not kept.
 */
import type { RunInput } from '@artifactbin/contracts';
import type { SqliteDatabase } from './database';

/** Each engine thread's default budget for prepared databases. */
const PREPARED_CACHE_BYTES = 32 * 1024 * 1024;

/** The identity of the database a catalog read mounts, or null when it is not cacheable (no catalog, an unkeyed source). */
export function preparedKey(input: Pick<RunInput, 'catalog'>): string | null {
  const catalog = input.catalog;
  if (!catalog || catalog.tables.some((t) => t.sql === undefined && typeof t.key !== 'string')) return null;
  return JSON.stringify([catalog.defaultSchema, catalog.tables.map((t) => [t.schema, t.name, t.columns, t.sql ?? null, t.key ?? null])]);
}

export class PreparedCache {
  readonly #entries = new Map<string, { db: SqliteDatabase; bytes: number }>();
  #bytes = 0;
  #builds = 0;
  #hits = 0;

  constructor(readonly maxBytes: number = PREPARED_CACHE_BYTES) {}

  /** The database built for `key`, now the most recently used, or undefined. */
  get(key: string): SqliteDatabase | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#hits++;
    return entry.db;
  }

  /**
   * Keep `db`, just built for `key`, evicting (and closing) the least recently used until the cap holds.
   * False when it alone exceeds the cap: the caller still owns it and closes it after its read.
   */
  keep(key: string, db: SqliteDatabase): boolean {
    this.#builds++;
    const bytes = db.bytes();
    if (bytes > this.maxBytes) return false;
    this.#drop(key);
    this.#entries.set(key, { db, bytes });
    this.#bytes += bytes;
    for (const older of this.#entries.keys()) {
      if (this.#bytes <= this.maxBytes) break;
      if (older !== key) this.#drop(older);
    }
    return true;
  }

  stats(): { entries: number; bytes: number; builds: number; hits: number } {
    return { entries: this.#entries.size, bytes: this.#bytes, builds: this.#builds, hits: this.#hits };
  }

  #drop(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#entries.delete(key);
    this.#bytes -= entry.bytes;
    entry.db.close();
  }
}
