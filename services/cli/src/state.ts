/**
 * The CLI's only local state: one SQLite database under the config directory
 * (`~/.artifactbin/state.sqlite`, or `$ARTIFACTBIN_HOME`). Nothing is ever
 * written into a user's workspace: no lockfile, no `.artifactbin/` directory.
 *
 * The store is deliberately narrow. Every kind of record (tracked file, pending
 * request, staged file, conflict, conversion, account entry, archive) is a JSON
 * document keyed by (scope, kind, key), with an optional BLOB for raw bytes.
 * Scope is a workspace root (realpath) or `HOME_SCOPE`. Typed wrappers live in
 * the module that owns each kind; this module never interprets a value.
 *
 * Writes that must land together run inside `transaction`. Cross-process
 * mutual exclusion for a workspace or the home directory uses `withLock`,
 * an OS-level SQLite lock that is released even after SIGKILL.
 */
import {createHash} from 'node:crypto';
import {chmod, lstat, mkdir, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import type {DatabaseSync} from 'node:sqlite';
import type * as SQLite from 'node:sqlite';
import {configDir} from './config';
import {isMissing} from './files';

export const HOME_SCOPE = 'home';
export type StateKind =
  | 'workspace'          // key: root         value: {server, account}
  | 'tracked'            // key: path         value: TrackedFile (workspace.ts)
  | 'staged-file'        // key: path         value: {before, sha256, mode}; data: bytes
  | 'pending-request'    // key: 'current'    value: PendingRequest (pending-request.ts)
  | 'pending-operation'  // key: 'current'    value: Operation (recoverable-operation.ts)
  | 'conflict'           // key: artifact id  value: {path, code, details}
  | 'conversion'         // key: source path  value: {target, sha256}
  | 'account'            // key: path         value: {resource, sha256}; the binding lives on the 'workspace' record
  | 'retired-create'     // key: path         value: {id, path, server, key}
  | 'archive';           // key: <kind>/<id>  value: anything kept for forensics, never read by commands

export interface StateRecord<T = unknown> {key: string; value: T; data: Buffer | null}

let sqlite:typeof SQLite|undefined;
/** Lazy builtin loading keeps read-only startup small. Node 22 emits this informational notice
 * synchronously on first load; silence only that notice and restore the handler before any async work.
 * Actual SQLite errors and every other warning retain their normal behavior. */
function loadSqlite():typeof SQLite {
  if(sqlite)return sqlite;
  const emitWarning=process.emitWarning;
  process.emitWarning=(warning:string|Error,...args:unknown[])=>{
    if(warning==='SQLite is an experimental feature and might change at any time'&&args[0]==='ExperimentalWarning')return;
    Reflect.apply(emitWarning,process,[warning,...args]);
  };
  try{return sqlite=process.getBuiltinModule('node:sqlite') as typeof SQLite;}
  finally{process.emitWarning=emitWarning;}
}

async function privateFile(path: string): Promise<void> {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  try { if (!(await lstat(path)).isFile()) throw new Error(`Expected a private file: ${path}`); }
  catch (error) { if (!isMissing(error)) throw error; }
}

export class State {
  private constructor(private readonly db: DatabaseSync, readonly path: string) {}

  static async open(home: string, env: NodeJS.ProcessEnv = process.env): Promise<State> {
    const path = join(configDir(home, env), 'state.sqlite');
    await privateFile(path);
    const {DatabaseSync} = loadSqlite();
    const db = new DatabaseSync(path);
    await chmod(path, 0o600);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS records (
        scope TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
        value TEXT NOT NULL, data BLOB, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (scope, kind, key)
      );
    `);
    return new State(db, path);
  }

  /** Reads never create local state: null when no store exists yet for this home. */
  static async openIfPresent(home: string, env: NodeJS.ProcessEnv = process.env): Promise<State | null> {
    try { await stat(join(configDir(home, env), 'state.sqlite')); }
    catch (error) { if (isMissing(error)) return null; throw error; }
    return State.open(home, env);
  }

  close(): void { this.db.close(); }

  /** Run `fn` atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.depth++ > 0) { try { return fn(); } finally { this.depth--; } }
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.depth--; }
  }
  private depth = 0;

  get<T = unknown>(scope: string, kind: StateKind, key: string): StateRecord<T> | null {
    const row = this.db.prepare('SELECT key, value, data FROM records WHERE scope = ? AND kind = ? AND key = ?').get(scope, kind, key) as {key: string; value: string; data: Uint8Array | null} | undefined;
    return row ? {key: row.key, value: JSON.parse(row.value) as T, data: row.data ? Buffer.from(row.data) : null} : null;
  }

  list<T = unknown>(scope: string, kind: StateKind): StateRecord<T>[] {
    const rows = this.db.prepare('SELECT key, value, data FROM records WHERE scope = ? AND kind = ? ORDER BY key').all(scope, kind) as Array<{key: string; value: string; data: Uint8Array | null}>;
    return rows.map(row => ({key: row.key, value: JSON.parse(row.value) as T, data: row.data ? Buffer.from(row.data) : null}));
  }

  /** Insert or replace. `exclusive` refuses to replace an existing record (returns false). */
  put(scope: string, kind: StateKind, key: string, value: unknown, options: {data?: Buffer | null; exclusive?: boolean} = {}): boolean {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('State values must be JSON');
    const sql = options.exclusive
      ? 'INSERT OR IGNORE INTO records (scope, kind, key, value, data) VALUES (?, ?, ?, ?, ?)'
      : 'INSERT OR REPLACE INTO records (scope, kind, key, value, data) VALUES (?, ?, ?, ?, ?)';
    return this.db.prepare(sql).run(scope, kind, key, encoded, options.data ?? null).changes > 0;
  }

  delete(scope: string, kind: StateKind, key: string): boolean {
    return this.db.prepare('DELETE FROM records WHERE scope = ? AND kind = ? AND key = ?').run(scope, kind, key).changes > 0;
  }

  /** Drop every record of one scope, for example when a workspace is untracked. */
  clearScope(scope: string): number {
    return Number(this.db.prepare('DELETE FROM records WHERE scope = ?').run(scope).changes);
  }

  /** The nearest registered workspace root at or above `directory` (both already realpath'd). */
  nearestWorkspace<T = unknown>(directory: string): {root: string; value: T} | null {
    for (let current = directory; ; current = dirname(current)) {
      const found = this.get<T>(current, 'workspace', current);
      if (found) return {root: current, value: found.value};
      if (dirname(current) === current) return null;
    }
  }
}

const locks = new Map<string, Promise<unknown>>();
export interface LockOptions {waitMs?: number}
/**
 * How long a competing operation waits for the scope before it is refused as
 * `workspace_busy`. Agents that run their tool calls in parallel (Pi, Claude Code)
 * routinely issue `afbin pull` and `afbin push` in the same turn; with no wait the
 * second one failed instantly in eval run 34694871143 even though the first finished
 * a second later. Queueing is the right default: a stale lock cannot exist (the OS releases
 * it when the holder exits), so only a hung holder should ever surface as busy.
 */
export const DEFAULT_LOCK_WAIT_MS = 60_000;
/** After this long in the queue, one stderr line says why the command is silent. */
const LOCK_WAIT_NOTICE_MS = 1_000;
/**
 * Cross-process mutual exclusion for one scope (a workspace root or HOME_SCOPE).
 * A zero-byte SQLite file under `<config>/locks/` holds a `BEGIN EXCLUSIVE`
 * transaction for the duration of `run`; the OS releases it on any exit.
 * Re-entrant within a process for the same scope. A busy scope is polled for
 * `waitMs` (default `DEFAULT_LOCK_WAIT_MS`) before `workspace_busy` is thrown.
 */
export async function withLock<T>(home: string, scope: string, run: () => Promise<T>, options: LockOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const name = createHash('sha256').update(scope).digest('hex').slice(0, 16);
  const file = join(configDir(home, env), 'locks', `${name}.sqlite`);
  if (locks.has(file)) return run();
  await privateFile(file);
  const {DatabaseSync} = loadSqlite();
  const db = new DatabaseSync(file);
  const held = (async () => {
    await chmod(file, 0o600);
    const started = Date.now();
    const deadline = started + Math.max(0, options.waitMs ?? DEFAULT_LOCK_WAIT_MS);
    let noticed = false;
    for (;;) {
      try { db.exec('BEGIN EXCLUSIVE'); break; }
      catch (error) {
        if ((error as {errcode?: number}).errcode !== 5) throw error;
        if (Date.now() >= deadline) throw new Error('workspace_busy: another afbin operation is using this directory. Retry when it finishes.');
        if (!noticed && Date.now() - started >= LOCK_WAIT_NOTICE_MS) { noticed = true; process.stderr.write('Waiting for another afbin operation in this directory to finish…\n'); }
        await sleep(Math.min(100, deadline - Date.now()));
      }
    }
    try { return await run(); }
    finally { db.exec('ROLLBACK'); }
  })();
  locks.set(file, held);
  try { return await held; }
  finally { locks.delete(file); db.close(); }
}
