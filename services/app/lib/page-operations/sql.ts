/**
 * `caps.sql` for resolvers, on the host: READ-ONLY SQL over the datasets the page links, as the caller, on the SQL
 * service (`run`: the read-only door registered page queries use). Data changes only through `caps.query`
 * mutations.
 *
 *   caps.sql(sql, params?)                                   → {columns, rows}
 *   caps.sql({queries:[{name, sql}], params?, paramTypes?, tables?, only?}) → {[name]: {columns, rows} | {error}}
 *
 * The batched form mirrors the SQL service's `RunInput`: queries run in order, a later one reads an earlier result
 * by name, and `tables` are inline author-typed tables. `only` names the queries whose answers come back (all by
 * default): the others still run, as dependencies, and neither travel back nor count against the answer cap. Dataset tables come from the caller's role view through the
 * same load `caps.query` uses (`read` port), so a call never shows more than the caller reads through GraphQL. A call
 * mounts only the linked datasets its SQL names. SQL can aggregate, so a mounted table whose rule for the caller
 * lacks `allow_aggregations` refuses the call. Limits are the registered page queries' (contracts
 * `SQL_READ_LIMITS`); the answer counts against `RESOLVER_LIMITS.queryResultBytes`.
 */
import { RESOLVER_LIMITS, SQL_READ_LIMITS as limits, type ColumnType, type DatasetColumn, type HtmlDatasetLink, type QueryOutcome, type Row, type RunInput, type RunnerCaller, type RunnerJson, type Scalar } from '@artifactbin/contracts';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { ResolverQueryError } from './query';

interface ResolverSqlInput {
  pageId: string;
  caller: RunnerCaller | null;
  operation: 'query' | 'mutation' | undefined;
  args: RunnerJson;
  signal?: AbortSignal;
}
export type ResolverSql = (input: ResolverSqlInput) => Promise<RunnerJson>;

/** One mounted dataset table as the caller reads it (lib/dataset-graphql `readLinkedDatasetTables`). */
export interface ResolverSqlTable {
  link: string;
  /** null: a single-table dataset, mounted as `<link>`; otherwise `<link>.<table>`. */
  table: string | null;
  columns: DatasetColumn[];
  rows: Row[];
  aggregatable: boolean;
}

export interface ResolverSqlPorts {
  /** The datasets the page links now (its head), live and pinned. */
  links(pageId: string): Promise<readonly HtmlDatasetLink[]>;
  /** The caller's tables of these links, at most `maxRows` rows together (more throws `sql_input_limit`). */
  read(actor: AccessActor, links: readonly HtmlDatasetLink[], options: { pageId: string; maxRows: number }, signal: AbortSignal): Promise<readonly ResolverSqlTable[]>;
  /** The SQL service's read door. */
  run(input: RunInput, signal: AbortSignal): Promise<Record<string, QueryOutcome>>;
  /** Test seam for the call's wall time. */
  scheduleDeadline?(ms: number, expire: () => void): () => void;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const COLUMN_TYPES: readonly ColumnType[] = ['string', 'number', 'boolean', 'date', 'timestamp', 'user'];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v: unknown): v is Scalar => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const refuse = (detail: string): never => { throw new ResolverQueryError('validation_failed', detail); };
const tooLarge = (detail: string): never => { throw new ResolverQueryError('input_too_large', detail); };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

interface Prepared {
  single: boolean;
  queries: Array<{ name: string; sql: string }>;
  params: Record<string, Scalar>;
  paramTypes: Record<string, ColumnType>;
  tables: Record<string, { columns: DatasetColumn[]; rows: Row[] }>;
  /** The names answered: every query unless the call named `only`. */
  answered: string[];
}

/** Either call form, checked: names, scalars, column types and the request-side limits. */
function prepare(args: RunnerJson): Prepared {
  if (!isObject(args)) return refuse('caps.sql takes a SQL string or {queries}');
  const single = typeof args.sql === 'string';
  const queries = single ? [{ name: 'result', sql: args.sql }] : args.queries;
  if (!Array.isArray(queries) || !queries.length || queries.length > limits.queries) return refuse(`queries is a list of 1 to ${limits.queries} {name, sql}`);
  const names = new Set<string>();
  const checked = queries.map((q) => {
    if (!isObject(q) || typeof q.name !== 'string' || !NAME.test(q.name) || typeof q.sql !== 'string') return refuse('each query is {name, sql} with a SQL identifier for a name');
    if (names.has(q.name.toLowerCase())) refuse(`query name ${q.name} is used twice`);
    if (Buffer.byteLength(q.sql) > limits.sqlBytes) refuse(`a query is at most ${limits.sqlBytes} bytes`);
    names.add(q.name.toLowerCase());
    return { name: q.name, sql: q.sql };
  });
  const params: Record<string, Scalar> = {};
  if (args.params !== undefined && args.params !== null) {
    if (!isObject(args.params)) refuse('params must be an object of scalars');
    const entries = Object.entries(args.params as Record<string, unknown>);
    if (entries.length > limits.params) refuse(`at most ${limits.params} params`);
    for (const [key, value] of entries) {
      if (!NAME.test(key) || !isScalar(value)) refuse(`param ${key.slice(0, 64)} must be a string, number, boolean or null under an identifier`);
      params[key] = value as Scalar;
    }
  }
  const paramTypes: Record<string, ColumnType> = {};
  if (!single && args.paramTypes !== undefined && args.paramTypes !== null) {
    if (!isObject(args.paramTypes)) refuse('paramTypes must be an object');
    for (const [key, type] of Object.entries(args.paramTypes as Record<string, unknown>)) {
      if (!Object.hasOwn(params, key) || !COLUMN_TYPES.includes(type as ColumnType)) refuse(`paramTypes.${key.slice(0, 64)} must type a param as ${COLUMN_TYPES.join(', ')}`);
      paramTypes[key] = type as ColumnType;
    }
  }
  const tables: Prepared['tables'] = {};
  if (!single && args.tables !== undefined && args.tables !== null) {
    if (!isObject(args.tables)) refuse('tables must be an object of {columns, rows}');
    const entries = Object.entries(args.tables as Record<string, unknown>);
    if (entries.length > limits.tables) refuse(`at most ${limits.tables} tables`);
    for (const [name, table] of entries) {
      if (!NAME.test(name) || names.has(name.toLowerCase())) refuse(`table ${name.slice(0, 64)} needs an identifier no query uses`);
      if (!isObject(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return refuse(`table ${name} is {columns, rows}`);
      const columns = table.columns.map((c): DatasetColumn => {
        if (!isObject(c) || typeof c.name !== 'string' || !c.name || c.name.length > 128 || !COLUMN_TYPES.includes(c.type as ColumnType)) return refuse(`table ${name}: each column is {name, type} with type ${COLUMN_TYPES.join(', ')}`);
        return { name: c.name, type: c.type as ColumnType };
      });
      if (!columns.length || new Set(columns.map((c) => c.name.toLowerCase())).size !== columns.length) refuse(`table ${name} needs distinct column names`);
      if (table.rows.length > limits.rows) tooLarge(`a call reads at most ${limits.rows} rows`);
      const rows = table.rows.map((row): Row => {
        if (!isObject(row)) return refuse(`table ${name}: each row is an object`);
        return Object.fromEntries(columns.map((c) => [c.name, isScalar(row[c.name]) ? row[c.name] : row[c.name] === undefined ? null : refuse(`table ${name}: cells are scalars`)]));
      });
      tables[name] = { columns, rows };
    }
  }
  let answered = checked.map((q) => q.name);
  if (args.only !== undefined && args.only !== null) {
    const only = args.only;
    if (single) refuse('only names queries of the batched form');
    if (!Array.isArray(only) || !only.length || new Set(only).size !== only.length || only.some((n) => typeof n !== 'string' || !names.has(n.toLowerCase()) || !checked.some((q) => q.name === n)))
      refuse('only lists distinct names of this call\'s queries');
    answered = only as string[];
  }
  return { single, queries: checked, params, paramTypes, tables, answered };
}

/** Could this SQL name the link? SQLite folds ASCII identifiers, so a name absent from the text is never read. */
const mentions = (sql: string, link: string) => sql.toLowerCase().includes(link.toLowerCase());

const CODES: Record<string, string> = { dataset_changed: 'conflict', dataset_not_found: 'unavailable' };

export function createResolverSql(ports: ResolverSqlPorts): ResolverSql {
  return async ({ pageId, caller, args, signal }) => {
    if (!caller) throw new ResolverQueryError('caller_unavailable', 'the run does not attest who called');
    const call = prepare(args);
    const controller = new AbortController();
    const forward = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted) forward();
    let expired = false;
    const cancelDeadline = (ports.scheduleDeadline ?? ((ms, expire) => { const timer = setTimeout(expire, ms); return () => clearTimeout(timer); }))(limits.wallMs, () => { expired = true; controller.abort(Error('sql_deadline')); });
    const active = controller.signal;
    // Every wait gives up at the deadline; the engine's own interrupt (timeoutMs) bounds each statement.
    const bounded = <T>(work: Promise<T>) => new Promise<T>((resolve, reject) => {
      const stop = () => reject(active.reason);
      if (active.aborted) { work.catch(() => {}); return stop(); }
      active.addEventListener('abort', stop, { once: true });
      work.then(resolve, reject).finally(() => active.removeEventListener('abort', stop));
    });
    try {
      const inlineRows = Object.values(call.tables).reduce((n, t) => n + t.rows.length, 0);
      if (inlineRows > limits.rows) tooLarge(`a call reads at most ${limits.rows} rows`);
      const linked = (await bounded(ports.links(pageId))).filter((link) => call.queries.some((q) => mentions(q.sql, link.name)));
      for (const link of linked) if (Object.keys(call.tables).some((name) => name.toLowerCase() === link.name.toLowerCase()) || call.queries.some((q) => q.name.toLowerCase() === link.name.toLowerCase()))
        refuse(`${link.name} names a linked dataset`);
      let mounted: readonly ResolverSqlTable[] = [];
      if (linked.length) {
        try {
          // The caller's account, nothing more: no token, email or host grant reaches the dataset decision.
          mounted = await bounded(ports.read(identityForUser(caller.subject), linked, { pageId, maxRows: limits.rows - inlineRows }, active));
        } catch (e) {
          if (e instanceof ResolverQueryError || expired) throw e;
          if (e instanceof Error && e.message === 'sql_input_limit') tooLarge(`a call reads at most ${limits.rows} rows`);
          if (e instanceof Error && CODES[e.message]) throw new ResolverQueryError(CODES[e.message]!);
          throw new ResolverQueryError('unavailable');
        }
      }
      const refused = mounted.find((t) => !t.aggregatable);
      if (refused) throw new ResolverQueryError('permission_denied', `caps.sql can aggregate, and your role's rule for ${refused.link} does not allow aggregations`);
      const input: RunInput = { tables: { ...call.tables }, queries: call.queries, params: call.params, paramTypes: call.paramTypes, limit: limits.rows, timeoutMs: limits.timeoutMs };
      const imports: NonNullable<RunInput['imports']> = {};
      for (const t of mounted) {
        if (t.table === null) input.tables[t.link] = { columns: t.columns, rows: t.rows };
        else (imports[t.link] ??= {})[t.table] = { columns: t.columns, rows: t.rows };
      }
      if (Object.keys(imports).length) input.imports = imports;
      const tables = [...Object.values(input.tables), ...Object.values(imports).flatMap((s) => Object.values(s))];
      if (tables.reduce((n, t) => n + t.rows.length, 0) > limits.rows || tables.reduce((n, t) => n + t.rows.length * t.columns.length, 0) > limits.cells) tooLarge(`a call reads at most ${limits.rows} rows and ${limits.cells} cells`);
      if (bytes(input) > limits.inputBytes) tooLarge(`a call reads at most ${limits.inputBytes} bytes`);
      let outcomes: Record<string, QueryOutcome>;
      try { outcomes = await bounded(ports.run(input, active)); } catch (e) {
        if (expired) throw e;
        throw new ResolverQueryError('unavailable');
      }
      const answers: Record<string, RunnerJson> = {};
      for (const name of call.answered) {
        const outcome = outcomes[name];
        answers[name] = !outcome ? { error: 'unavailable: the query did not run' }
          : 'error' in outcome ? { error: outcome.timedOut ? `timeout: a query runs at most ${limits.timeoutMs} ms` : outcome.error }
          : outcome.truncated ? { error: `result_too_large: a result is at most ${limits.rows} rows` }
          : { columns: outcome.columns.map((c) => ({ name: c.name, type: c.type })), rows: outcome.rows as RunnerJson[] };
      }
      const answer: RunnerJson = call.single ? answers.result! : answers;
      if (call.single && isObject(answer) && typeof answer.error === 'string') {
        const [code, ...detail] = answer.error.split(': ');
        throw /^(timeout|result_too_large|unavailable)$/.test(code!) ? new ResolverQueryError(code!, detail.join(': ')) : new ResolverQueryError('validation_failed', answer.error);
      }
      if (bytes(answer) > RESOLVER_LIMITS.queryResultBytes) throw new ResolverQueryError('result_too_large', `a caps.sql answer is at most ${RESOLVER_LIMITS.queryResultBytes} bytes`);
      return answer;
    } catch (e) {
      if (expired) throw new ResolverQueryError('timeout', `a caps.sql call runs at most ${limits.wallMs} ms`);
      throw e;
    } finally {
      cancelDeadline();
      signal?.removeEventListener('abort', forward);
    }
  };
}
