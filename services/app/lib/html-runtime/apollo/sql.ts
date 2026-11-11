/**
 * `sql` IN THE PAGE RUNTIME (`import {sql} from '@afbin/apollo'`): a tagged template over the page SQL door
 * (POST /api/artifacts/<page>/sql through the frame relay, lib/page-doors `pageSqlDoor`).
 *
 *   const rows = await sql`select region, sum(amount) as total from sales where year = ${year} group by region`;
 *   const { affected, returning } = await sql`insert into tasks (title) values (${title})`;
 *   const stop = sql.watch(sql`select count(*) as open from tasks where not done`, rows => …);
 *
 * Every `${…}` is a bound parameter (`$p0`, `$p1`…), never SQL text: a string, finite number, boolean, null or Date
 * (its ISO instant); anything else throws before anything is sent. A statement is lazy and re-runnable: each await
 * runs it once, under its own Idempotency-Key. A read answers its rows (the array carries `columns`), a write
 * `{affected, returning}`; a refusal rejects with SqlError (`code`, `message`).
 *
 * `watch` runs the statement now and again whenever the page's names-only invalidation names a link the statement
 * text mentions (or names none: a change of who reads), one request in flight and one dirty bit, never a queue.
 *
 * A DECLARED QUERY (a live dataset's, `<script type="application/sql" data-af-query="NAME" data-af-dataset="LINK">`):
 *
 *   const rows = await sql.query('revenue', { year: 2026 });
 *   const stop = sql.watch(sql.query('revenue', { year }), rows => …);
 *
 * sends only the name and the values of its `:name` parameters; the server runs the SQL the open version of the page
 * declares, filling `:viewer_id`, `:viewer_email` and `:viewer_groups` itself.
 */
import type { HtmlJsonObject as AfJsonObject } from '@artifactbin/contracts';

type SqlValue = string | number | boolean | null | Date;
interface SqlColumn { name: string; type: string }
type SqlRows = AfJsonObject[] & { columns: SqlColumn[] };
interface SqlWrite { affected: number; returning: AfJsonObject[] }
type Reply = { columns: SqlColumn[]; rows: AfJsonObject[] } | SqlWrite | { error: string; message?: string };

/** The transport: the frame relay in a hosted page (lib/html-runtime/browser-reader). */
export interface SqlPort {
  /** `sql`: a statement; `query`: a declared query's name instead (never both). */
  run(request: { sql?: string; query?: string; params: Record<string, string | number | boolean | null>; idempotencyKey: string }): Promise<Reply>;
  /** Names-only invalidations (dataset link names; none: everything); returns its cleanup. */
  subscribe(listener: (names?: readonly string[]) => void): () => void;
}

export class SqlError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'SqlError'; }
}

interface SqlStatement extends PromiseLike<SqlRows | SqlWrite> {
  readonly text: string;
  /** A declared query's name (`sql.query`); its text is then the server's. */
  readonly query?: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}
export interface SqlTag {
  (strings: TemplateStringsArray, ...values: SqlValue[]): SqlStatement;
  watch(statement: SqlStatement, next: (rows: SqlRows) => void, error?: (error: SqlError) => void): () => void;
  /** The page's declared query `name`, with values for its `:name` parameters. */
  query(name: string, params?: Record<string, SqlValue>): SqlStatement;
}

function bound(value: unknown, i: number | string): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  throw new TypeError(`sql value ${i} must be a string, finite number, boolean, null or Date`);
}

const key = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).replaceAll(/[^A-Za-z0-9_-]/g, '');

export function createSql(port: SqlPort): SqlTag {
  const run = async (statement: SqlStatement): Promise<SqlRows | SqlWrite> => {
    const reply = await port.run({ ...(statement.query !== undefined ? { query: statement.query } : { sql: statement.text }), params: { ...statement.params }, idempotencyKey: key() });
    if (!reply || typeof reply !== 'object') throw new SqlError('unexpected', 'Invalid SQL reply');
    if ('error' in reply) throw new SqlError(String(reply.error), reply.message ?? String(reply.error));
    // `columns` rides on the array, out of iteration and JSON, and stays an ordinary property: a chart library handed
    // the rows may rewrite or delete it (Vega's data ingestion deletes an array's `columns`, d3-dsv style).
    if ('rows' in reply) return Object.defineProperty([...reply.rows], 'columns', { value: reply.columns, enumerable: false, writable: true, configurable: true }) as SqlRows;
    return { affected: reply.affected, returning: reply.returning ?? [] };
  };
  const tag = ((strings: TemplateStringsArray, ...values: SqlValue[]): SqlStatement => {
    const params: Record<string, string | number | boolean | null> = {};
    let text = strings[0] ?? '';
    values.forEach((value, i) => { params[`p${i}`] = bound(value, i); text += `$p${i}${strings[i + 1] ?? ''}`; });
    const statement: SqlStatement = {
      text, params,
      then: (resolve, reject) => run(statement).then(resolve, reject),
    };
    return statement;
  }) as SqlTag;
  tag.query = (name, values = {}) => {
    if (typeof name !== 'string' || !name) throw new TypeError('sql.query takes a declared query\'s name');
    const params: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(values)) params[k] = bound(v, k as never);
    const statement: SqlStatement = { text: '', query: name, params, then: (resolve, reject) => run(statement).then(resolve, reject) };
    return statement;
  };
  tag.watch = (statement, next, error) => {
    let active = true, running = false, dirty = true;
    const lower = statement.text.toLowerCase();
    const pump = async () => {
      if (running) return;
      running = true;
      try {
        while (active && dirty) {
          dirty = false;
          try {
            const rows = await run(statement);
            if (active && Array.isArray(rows)) next(rows);
          } catch (e) {
            if (active) error?.(e instanceof SqlError ? e : new SqlError('unexpected', e instanceof Error ? e.message : String(e)));
          }
        }
      } finally { running = false; }
    };
    const stopRemote = port.subscribe((names) => {
      if (!active || (names?.length && !names.some((n) => lower.includes(n.toLowerCase())))) return;
      dirty = true;
      void pump();
    });
    void pump();
    return () => { active = false; stopRemote(); };
  };
  return tag;
}
