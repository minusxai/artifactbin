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
 * runs it once, under its own Idempotency-Key. A read answers its rows (the array carries `columns`, and
 * `truncated: true` when a connection cut the rows at the row limit), a write `{affected, returning}`.
 *
 * A FAILURE rejects with SqlError: `code` from contracts `SQL_FAILURES` (the one list), `message` one sentence for the
 * reader when the read's failure has one (else the reason), `detail` the server's own reason for the author. No reply
 * (the relay or the app unreachable) is `unavailable`; a reply that is not one is `unexpected`.
 *
 * `watch` runs the statement now and again whenever the page's names-only invalidation names a link the statement
 * text mentions (or names none: a change of who reads), one request in flight and one dirty bit, never a queue. A
 * failure goes to `error`; with no `error` it is reported as an uncaught error (reportError), never dropped.
 *
 * A DECLARED QUERY (a live dataset's, `<script type="application/sql" data-af-query="NAME" data-af-dataset="LINK">`):
 *
 *   const rows = await sql.query('revenue', { year: 2026 });
 *   const stop = sql.watch(sql.query('revenue', { year }), rows => …);
 *
 * sends only the name and the values of its `:name` parameters; the server runs the SQL the open version of the page
 * declares, filling `:viewer_id`, `:viewer_email` and `:viewer_groups` itself. Its text is not the page's, so a
 * watch of one runs again on every invalidation, whichever links it names.
 */
import type { HtmlJsonObject as AfJsonObject } from '@artifactbin/contracts';
import { SQL_FAILURES } from '@artifactbin/contracts/sql-failures';

type SqlValue = string | number | boolean | null | Date;
interface SqlColumn { name: string; type: string }
type SqlRows = AfJsonObject[] & { columns: SqlColumn[]; truncated?: true };
interface SqlWrite { affected: number; returning: AfJsonObject[] }
type Reply = { columns: SqlColumn[]; rows: AfJsonObject[]; truncated?: boolean } | SqlWrite | { error: string; message?: string; notice?: string };

/** The transport: the frame relay in a hosted page (lib/html-runtime/browser-reader). */
export interface SqlPort {
  /** `sql`: a statement; `query`: a declared query's name instead (never both). */
  run(request: { sql?: string; query?: string; params: Record<string, string | number | boolean | null>; idempotencyKey: string }): Promise<Reply>;
  /** Names-only invalidations (dataset link names; none: everything); returns its cleanup. */
  subscribe(listener: (names?: readonly string[]) => void): () => void;
}

export class SqlError extends Error {
  /** `message`: for the reader; `detail`: the server's own reason (the same text when there is no reader's sentence). */
  constructor(readonly code: string, message: string, readonly detail: string = message) { super(message); this.name = 'SqlError'; }
}
/** A failure the runtime itself names, with the list's sentence for the reader. */
const failure = (code: 'unavailable' | 'unexpected', detail: string) => new SqlError(code, SQL_FAILURES[code].notice, detail);

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
    let reply: Reply;
    try { reply = await port.run({ ...(statement.query !== undefined ? { query: statement.query } : { sql: statement.text }), params: { ...statement.params }, idempotencyKey: key() }); }
    catch (e) { throw e instanceof SqlError ? e : failure('unavailable', e instanceof Error ? e.message : String(e)); }
    if (!reply || typeof reply !== 'object') throw failure('unexpected', 'Invalid SQL reply');
    if ('error' in reply) {
      const reason = typeof reply.message === 'string' ? reply.message : String(reply.error);
      // The uniform `{error: 'not_found'}` carries no words of its own: the list's sentence is the reader's.
      const notice = typeof reply.notice === 'string' ? reply.notice : reply.error === 'not_found' && reply.message === undefined ? SQL_FAILURES.not_found.notice : reason;
      throw new SqlError(String(reply.error), notice, reason);
    }
    // `columns` rides on the array, out of iteration and JSON, and stays an ordinary property: a chart library handed
    // the rows may rewrite or delete it (Vega's data ingestion deletes an array's `columns`, d3-dsv style).
    if ('rows' in reply) {
      const rows = Object.defineProperty([...reply.rows], 'columns', { value: reply.columns, enumerable: false, writable: true, configurable: true }) as SqlRows;
      return reply.truncated ? Object.defineProperty(rows, 'truncated', { value: true, enumerable: false, writable: true, configurable: true }) : rows;
    }
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
            const failed = e instanceof SqlError ? e : failure('unexpected', e instanceof Error ? e.message : String(e));
            if (active && error) error(failed);
            else if (active) (globalThis.reportError ?? ((x: unknown) => queueMicrotask(() => { throw x; })))(failed);
          }
        }
      } finally { running = false; }
    };
    const stopRemote = port.subscribe((names) => {
      // A declared query's SQL is the server's, so the page cannot see which links it reads: any change re-runs it.
      if (!active || (statement.query === undefined && names?.length && !names.some((n) => lower.includes(n.toLowerCase())))) return;
      dirty = true;
      void pump();
    });
    void pump();
    return () => { active = false; stopRemote(); };
  };
  return tag;
}
