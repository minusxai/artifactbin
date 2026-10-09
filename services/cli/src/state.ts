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
import {chmod, lstat, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type * as SQLite from 'node:sqlite';
import {configDir} from './config';
import {withStateLock} from '@artifactbin/utils/node/state-lock';
import {isMissing,privateDirectory} from './files';

export const HOME_SCOPE = 'home';
export type StateKind =
  | 'remote-agent'      // key: server/session; private launch metadata and pending exit receipt (no credentials)
  | 'claude-conversation' // key: server/relay-session; private resumable Claude identity and launch context
  | 'claude-conversation-reservation' // key: server/Claude UUID; atomic explicit-resume launch reservation
  | 'identity-pool'
  | 'draft-identity'
  | 'identity-move'
  | 'workspace'          // key: root         value: {server, account}
  | 'tracked'            // key: path         value: TrackedFile (workspace.ts)
  | 'staged-file'        // key: path         value: {before, sha256, mode}; data: bytes
  | 'pending-request'    // key: 'current'    value: PendingRequest (pending-request.ts)
  | 'pending-operation'  // key: 'current'    value: Operation (recoverable-operation.ts)
  | 'conflict'           // key: artifact id  value: {path, code, details}
  | 'conversion'         // key: source path  value: {target, sha256}
  | 'account'            // key: path         value: {resource, sha256}; the binding lives on the 'workspace' record
  | 'retired-create'     // key: path         value: {id, path, server, key}
  | 'background-update' // key: server origin; value: local check/backoff timestamps
  | 'server-identity'   // key: selected origin; value: {canonical, aliases, checkedAt} (server-identity.ts)
  | 'preview-thread'    // key: thread id; value: local production annotation wire
  | 'preview-thread-request' // key: file and idempotency key; value: thread id
  | 'preview-comment'   // key: comment id; value: selected-file/node attribution and text
  | 'archive';           // key: <kind>/<id>  value: anything kept for forensics, never read by commands

interface StateRecord<T = unknown> {key: string; value: T; data: Buffer | null}

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
  await privateDirectory(dirname(path));
  try { if (!(await lstat(path)).isFile()) throw new Error(`Expected a private file: ${path}`); }
  catch (error) { if (!isMissing(error)) throw error; }
}

export class State {
  private constructor(private readonly db: DatabaseSync, readonly path: string) {}

  static async open(home: string, env: NodeJS.ProcessEnv = process.env, options: {waitMs?:number} = {}): Promise<State> {
    const path = join(configDir(home, env), 'state.sqlite');
    await privateFile(path);
    const {DatabaseSync} = loadSqlite();
    const db = new DatabaseSync(path);
    try {
    await chmod(path, 0o600);
    db.exec(`
      PRAGMA busy_timeout = ${Math.max(0,Math.floor(options.waitMs??5000))};
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS records (
        scope TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
        value TEXT NOT NULL, data BLOB, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (scope, kind, key)
      );
    `);
    return new State(db, path);
    }catch(error){db.close();throw error;}
  }

  /** Nonblocking scheduling read: no schema setup, writes, or lock wait on the foreground path. */
  static async openReadOnly(home: string, env: NodeJS.ProcessEnv = process.env): Promise<State | null> {
    const path = join(configDir(home, env), 'state.sqlite');
    try { await stat(path); } catch(error) { if(isMissing(error))return null; throw error; }
    const {DatabaseSync}=loadSqlite();
    const db=new DatabaseSync(path,{readOnly:true});
    db.exec('PRAGMA busy_timeout = 0');
    return new State(db,path);
  }

  /** Reads never create local state: null when no store exists yet for this home. */
  static async openIfPresent(home: string, env: NodeJS.ProcessEnv = process.env): Promise<State | null> {
    try { await stat(join(configDir(home, env), 'state.sqlite')); }
    catch (error) { if (isMissing(error)) return null; throw error; }
    return State.open(home, env);
  }

  /** Move a portable staging scope without replacing any existing workspace. */
  rebaseScope(from: string, to: string): void {
    if (from === to) return;
    this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM records WHERE scope = ? LIMIT 1').get(to)) throw new Error('Destination state scope already exists');
      this.db.prepare("UPDATE records SET scope = ?, key = CASE WHEN kind = 'workspace' AND key = ? THEN ? ELSE key END WHERE scope = ?").run(to, from, to, from);
    });
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

/** Shared with standalone HTTP refresh; preserve the original scope/file protocol. */
export async function withLock<T>(home:string,scope:string,run:()=>Promise<T>,options:import('@artifactbin/utils/node/state-lock').LockOptions={},env:NodeJS.ProcessEnv=process.env):Promise<T>{
 return withStateLock(configDir(home,env),scope,run,options);
}
