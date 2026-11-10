/**
 * `_sql` IN LOCAL PREVIEW: the page's read-only SQL door over the local datasets, owner view (every column and
 * row, as local GraphQL reads them). Node-only: each call copies the datasets' current rows into a THROWAWAY
 * in-memory `node:sqlite` database, under the names a published page gives them (a single-table dataset is
 * `<link>`, a multi-table one `<link>.<table>`, every table with `_id`), runs one statement and drops it.
 *
 * The skill ships no SQLite wasm, so this is not the hosted engine: the hosted page runs `_sql` on the SQL
 * service (STRICT types, its function list, its 5 s deadline) and that answer is authoritative; `check.mjs`
 * against the published page is the real check. What holds here as there: one read statement (SELECT, WITH or
 * VALUES; a second statement or any change is refused), bound `$name` params, at most
 * SQL_READ_LIMITS.rows result rows, booleans answered as booleans.
 */
import { SQL_READ_LIMITS, type ColumnType, type DatasetColumn, type Scalar } from '@artifactbin/contracts';
import { GraphQLError } from 'graphql';
import { quote } from './model';

/** One local table as the page names it: `table` null for a single-table dataset (mounted as `<link>`). */
export interface LocalSqlTable { link: string; table: string | null; columns: DatasetColumn[]; rows: Record<string, unknown>[]; rowIds: readonly string[] }
export interface LocalSqlAnswer { columns: Array<{ name: string; type: ColumnType }>; rows: Array<Record<string, unknown>> }

type Statement = { iterate(params: Record<string, unknown>): Iterable<Record<string, unknown>>; columns?(): Array<{ name: string; column: string | null; table: string | null; database: string | null }> };
type Database = { exec(sql: string): void; prepare(sql: string): Statement & { all(params?: Record<string, unknown>): Record<string, unknown>[] }; close(): void };

const refuse = (code: string, message: string): never => { throw new GraphQLError(message, { extensions: { code } }); };
const sqlType = (type: ColumnType) => (type === 'number' ? 'REAL' : type === 'boolean' ? 'INTEGER' : 'TEXT');

/**
 * The statement's shape before it runs, outside string literals, quoted names and comments: its first keyword and
 * whether anything but whitespace or comments follows a top-level `;`.
 */
function statementShape(sql: string): { keyword: string; trailing: boolean } {
  let keyword = '', i = 0, ended = false, trailing = false;
  while (i < sql.length) {
    const c = sql[i]!, next = sql[i + 1];
    if (c === '-' && next === '-') { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (c === '/' && next === '*') { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (ended) { trailing = true; break; }
    if (c === ';') { ended = true; i++; continue; }
    const close = c === "'" ? "'" : c === '"' ? '"' : c === '`' ? '`' : c === '[' ? ']' : null;
    if (close) {
      let j = i + 1;
      for (; j < sql.length; j++) if (sql[j] === close) { if (close !== ']' && sql[j + 1] === close) { j++; continue; } break; }
      i = j + 1; continue;
    }
    if (!keyword && /[A-Za-z]/.test(c)) { keyword = /^[A-Za-z]+/.exec(sql.slice(i))![0].toUpperCase(); i += keyword.length; continue; }
    i++;
  }
  return { keyword, trailing };
}

async function openDatabase(): Promise<Database> {
  let sqlite: { DatabaseSync: new (path: string) => Database };
  try { sqlite = await import('node:sqlite') as unknown as typeof sqlite; } catch { throw new Error('Local preview of page SQL needs Node 22.13 or newer (node:sqlite); upgrade Node'); }
  return new sqlite.DatabaseSync(':memory:');
}

/** One `_sql` call over these tables (only those the SQL text names are mounted, as the hosted door does). */
export async function runLocalSql(tables: readonly LocalSqlTable[], sql: string, params: Readonly<Record<string, Scalar>>): Promise<LocalSqlAnswer> {
  const shape = statementShape(sql);
  if (!['SELECT', 'WITH', 'VALUES'].includes(shape.keyword)) refuse('validation_failed', '_sql runs one read-only statement: SELECT, WITH or VALUES');
  if (shape.trailing) refuse('validation_failed', '_sql runs exactly one statement');
  const db = await openDatabase();
  try {
    const typed = new Map<string, ColumnType>(), attached = new Set<string>();
    for (const t of tables.filter((t) => sql.toLowerCase().includes(t.link.toLowerCase()))) {
      if (t.table !== null && !attached.has(t.link)) { db.exec(`ATTACH DATABASE ':memory:' AS ${quote(t.link)}`); attached.add(t.link); }
      const target = t.table === null ? quote(t.link) : `${quote(t.link)}.${quote(t.table)}`;
      const id = !t.columns.some((c) => c.name.toLowerCase() === '_id');
      const columns = [...(id ? [{ name: '_id', type: 'string' as const }] : []), ...t.columns];
      db.exec(`CREATE TABLE ${target} (${columns.map((c) => `${quote(c.name)} ${sqlType(c.type)}`).join(', ')})`);
      for (const c of columns) typed.set(JSON.stringify([t.table === null ? 'main' : t.link, t.table ?? t.link, c.name].map((s) => s.toLowerCase())), c.type);
      const insert = db.prepare(`INSERT INTO ${target} (${columns.map((c) => quote(c.name)).join(', ')}) VALUES (${columns.map((_, j) => `$c${j}`).join(', ')})`);
      t.rows.forEach((row, r) => insert.all(Object.fromEntries(columns.map((c, j) => {
        const v = c.name === '_id' && id ? t.rowIds[r] ?? null : row[c.name] ?? null;
        return [`c${j}`, typeof v === 'boolean' ? Number(v) : v];
      }))));
    }
    const changes = () => Number(db.prepare('SELECT total_changes() AS n').all()[0]?.n ?? 0);
    const before = changes();
    let statement: Statement;
    try { statement = db.prepare(sql); } catch (e) { return refuse('validation_failed', (e as Error).message); }
    const bound: Record<string, unknown> = {};
    for (const name of new Set([...sql.matchAll(/[$:@]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!))) {
      if (!Object.hasOwn(params, name)) continue;
      const v = params[name];
      bound[name] = typeof v === 'boolean' ? Number(v) : v;
    }
    for (const m of sql.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) if (!Object.hasOwn(params, m[1]!)) refuse('validation_failed', `Dataset SQL: undeclared parameter $${m[1]}`);
    const origin = statement.columns?.() ?? [];
    const rows: Array<Record<string, unknown>> = [];
    try {
      for (const row of statement.iterate(bound)) {
        if (rows.length >= SQL_READ_LIMITS.rows) refuse('result_too_large', `a result is at most ${SQL_READ_LIMITS.rows} rows`);
        rows.push({ ...row });
      }
    } catch (e) {
      if (e instanceof GraphQLError) throw e;
      refuse('validation_failed', (e as Error).message);
    }
    if (changes() !== before) refuse('validation_failed', '_sql runs one read-only statement: SELECT, WITH or VALUES');
    const names = origin.length ? origin.map((c) => c.name) : Object.keys(rows[0] ?? {});
    const columns = names.map((name, i) => {
      const o = origin[i];
      const declared = o?.column && o.table ? typed.get(JSON.stringify([o.database ?? 'main', o.table, o.column].map((s) => s.toLowerCase()))) : undefined;
      const sample = rows.find((r) => r[name] !== null && r[name] !== undefined)?.[name];
      return { name, type: declared ?? (typeof sample === 'number' ? 'number' as const : 'string' as const) };
    });
    // node:sqlite has no booleans: a boolean column's 0/1 reads back as true/false.
    for (const c of columns) if (c.type === 'boolean') for (const r of rows) if (r[c.name] !== null) r[c.name] = !!r[c.name];
    return { columns, rows };
  } finally {
    db.close();
  }
}
