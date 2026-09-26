/**
 * THE DOCUMENT COMPILER — the one place that understands SQL.
 *
 * Publishing turns a document's `<Helmet>` declarations (lib/story/dataflow
 * `Dataflow`) into a `CompiledDataflow`: every query a typed function of the
 * values it binds, every mutation an action with a signature, and one graph of
 * what reads what — all taken from SQLite's own report while it prepares each
 * statement (`@artifactbin/sql/core` `analyze`). Nothing downstream reads SQL
 * text again.
 *
 * Two halves, so compiling itself is synchronous and can run wherever the
 * source is final (after node ids are stamped, before a transaction opens):
 *  - `prepareCompile` (async) loads the engine and every artifact the
 *    declarations name — import shapes, and the result shape of each query
 *    that runs inside a connected Postgres database;
 *  - `compileDataflow` (sync) compiles against that snapshot.
 *
 * Queries compile depth-first: a statement that fails with "no such table: X"
 * where X is a declared query compiles X first and retries, so authored order
 * does not matter and a cycle is found on the path (and named). Output column
 * types come from the column a result directly projects (SQLite's origin
 * metadata — through an earlier query, that query's compiled type), else from
 * the values a dry run over the document's own data produces, else null.
 */
import { paramSqlName, type ColumnType, type DatasetColumn, type Scalar, type StatementAnalysis } from '@artifactbin/contracts';
import { loadSqlite, type Relation, type SqliteEngine } from '@artifactbin/sql/core';
import { isQueryFailure } from '@artifactbin/contracts';
import type { JsxNode, ValidationError } from '@/lib/jsx';
import { BUILTIN_TABLES, builtinInput, isBuiltinTable, rowField, VIEWER, VIEWER_ID } from './builtins';
import type { BuiltinInput, BuiltinTable, CompiledDataflow, CompiledImport, CompiledMutation, CompiledQuery, CompiledReads, CompiledValue } from './compiled-dataflow';
import { ARGS_ATTR, bindingMap, MUTATION_TAG, QUERY_TAG, refName, scalarMatches, SET_ATTR, type Dataflow, type MutationDecl, type QueryDecl } from './dataflow';
import { analyzeRowScopes } from './row-scope';

/** What an `<Import>` or `source=` names, as the loader found it. */
export interface ImportSource {
  kind: 'dataset' | 'folder' | 'postgres';
  /** The tables an import exposes under its name (`rows` for a flat dataset or a folder listing). */
  tables: Array<{ name: string; columns: DatasetColumn[] }>;
  /**
   * A connected database only: run a query inside it (params by SQL name) to
   * learn its result shape and the parameters it binds.
   */
  probe?: (sql: string, params: Record<string, Scalar>, types: Record<string, ColumnType>) => Promise<{ columns: DatasetColumn[]; params: string[] }>;
}
export type SchemaLoader = (ref: string) => Promise<ImportSource | null>;

/** A Postgres query's shape, probed by `prepareCompile`, keyed by `postgresKey`. */
type PostgresShape = { columns: DatasetColumn[]; params: string[] } | { error: string };

export interface CompileContext {
  engine: SqliteEngine;
  /** Every ref the declarations name → what it is, or null when it does not resolve. */
  sources: Record<string, ImportSource | null>;
  postgres: Record<string, PostgresShape>;
  /** The instant the dry run reads as `$_now` (tests pin it). */
  now?: string;
}

export type CompileResult = { ok: true; compiled: CompiledDataflow } | { ok: false; errors: ValidationError[] };

// ── the built-in fields, rewritten for SQLite ─────────────────────────────

/**
 * `$_me.id` → `$_me__id` (paramSqlName): a SQLite parameter cannot hold a dot.
 * A token scan, skipping strings, quoted identifiers and comments — the only
 * text work the compiler does; everything else is the engine's analysis.
 * Also answers whether the statement holds the literal `'now'`, the one clock
 * read SQLite's authorizer cannot report (a function argument is not an event).
 */
export function rewriteBuiltinFields(sql: string): { sql: string; fields: Map<string, string>; now: boolean; branches: string[] | null } {
  const fields = new Map<string, string>();
  let out = '', i = 0, now = false, depth = 0, body = -1;
  /** Top-level UNION/INTERSECT/EXCEPT, as [start, end) in the rewritten text. */
  const compounds: Array<[number, number]> = [];
  const skipTo = (end: number) => { out += sql.slice(i, end); i = end; };
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === '\'') {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === '\'') { if (sql[j + 1] === '\'') { j += 2; continue; } break; } j++; }
      if (sql.slice(i + 1, j).toLowerCase() === 'now') now = true;
      skipTo(Math.min(sql.length, j + 1));
    } else if (c === '"' || c === '`') {
      const end = sql.indexOf(c, i + 1);
      skipTo(end < 0 ? sql.length : end + 1);
    } else if (c === '[') {
      const end = sql.indexOf(']', i + 1);
      skipTo(end < 0 ? sql.length : end + 1);
    } else if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      skipTo(end < 0 ? sql.length : end);
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      skipTo(end < 0 ? sql.length : end + 2);
    } else if (c === '$') {
      const dollar = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (dollar) { const end = sql.indexOf(dollar[0], i + dollar[0].length); skipTo(end < 0 ? sql.length : end + dollar[0].length); continue; }
      const param = /^\$(_[A-Za-z]\w*)\.([A-Za-z_]\w*)/.exec(sql.slice(i));
      if (param) {
        const logical = `${param[1]}.${param[2]}`;
        fields.set(paramSqlName(logical), logical);
        out += `$${paramSqlName(logical)}`;
        i += param[0].length;
      } else { out += c; i++; }
    } else if (/[A-Za-z_]/.test(c) && !/\w/.test(sql[i - 1] ?? '')) {
      const w = /^[A-Za-z_]\w*/.exec(sql.slice(i))![0];
      const lower = w.toLowerCase();
      if (depth === 0 && body < 0 && (lower === 'select' || lower === 'values')) body = out.length;
      if (depth === 0 && (lower === 'union' || lower === 'intersect' || lower === 'except')) {
        const all = /^\s+all\b/i.exec(sql.slice(i + w.length))?.[0] ?? '';
        compounds.push([out.length, out.length + w.length + all.length]);
        out += w + all; i += w.length + all.length;
      } else { out += w; i += w.length; }
    } else {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      out += c; i++;
    }
  }
  // A compound's branches, each a statement of its own (the WITH clause before the first branch is every branch's).
  const branches = compounds.length && body >= 0
    ? [body, ...compounds.map(([, end]) => end)].map((from, n) => out.slice(0, body) + out.slice(from, compounds[n]?.[0] ?? out.length))
    : null;
  return { sql: out, fields, now, branches };
}

/** The clock functions a statement may not call: the current time is `$_now`, identical on server and browser. */
const CLOCK_FUNCTIONS = new Set(['current_date', 'current_time', 'current_timestamp']);
/** Functions that read `'now'` when handed it. */
const DATE_FUNCTIONS = new Set(['date', 'time', 'datetime', 'julianday', 'strftime', 'unixepoch', 'timediff']);

// ── the context: everything asynchronous, up front ────────────────────────

export const postgresKey = (q: Pick<QueryDecl, 'name' | 'sql'>): string => `${q.name}\0${q.sql}`;

/** Load the engine and every artifact the declarations name. */
export async function prepareCompile(flow: Dataflow, load: SchemaLoader): Promise<CompileContext> {
  const engine = await loadSqlite();
  const refs = [...new Set([...flow.imports.map((i) => i.ref), ...flow.queries.flatMap((q) => (q.source ? [q.source] : [])), ...flow.values.flatMap((v) => (v.kind === 'scalar' && v.source ? [v.source] : []))])];
  const sources: CompileContext['sources'] = Object.fromEntries(await Promise.all(refs.map(async (ref) => [ref, await load(ref).catch(() => null)] as const)));
  const postgres: CompileContext['postgres'] = {};
  const types = scalarTypes(flow);
  for (const q of flow.queries) {
    const source = q.source ? sources[q.source] : null;
    if (!source?.probe) continue;
    const { sql, fields } = rewriteBuiltinFields(q.sql);
    // The declared defaults, and the platform's built-ins as a guest would see them now.
    const defaults: Record<string, Scalar> = { ...Object.fromEntries(flow.values.flatMap((v) => (v.kind === 'scalar' ? [[v.name, v.default]] : []))), [paramSqlName('_me.id')]: null, _now: new Date().toISOString(), _tz: 'UTC' };
    for (const sqlName of fields.keys()) defaults[sqlName] ??= null;
    const bindTypes: Record<string, ColumnType> = { ...types, _now: 'timestamp', _tz: 'string' };
    for (const [sqlName, logical] of fields) { const t = builtinInput(logical)?.type; if (t) bindTypes[sqlName] = t; }
    try { postgres[postgresKey(q)] = await source.probe(sql, defaults, bindTypes); }
    catch (error) { postgres[postgresKey(q)] = { error: error instanceof Error ? error.message : 'the query could not run' }; }
  }
  return { engine, sources, postgres };
}

const scalarTypes = (flow: Dataflow): Record<string, ColumnType> =>
  Object.fromEntries(flow.values.flatMap((v) => (v.kind === 'scalar' ? [[v.name, v.type]] : [])));

// ── compiling ─────────────────────────────────────────────────────────────

type Span = { start: number; end: number };
const at = (span: Span, tag: string, message: string, attr?: string): ValidationError => ({ message, tag, start: span.start, end: span.end, ...(attr ? { attr } : {}) });
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error: /, '');

/**
 * Compile a document's declarations (and, with `body`, check the markup that
 * binds them: `run=` arguments, `args=`, `set=`, row scopes) against a
 * prepared context. Every error carries the span of the declaration or the
 * control it concerns and says what to do.
 */
export function compileDataflow(flow: Dataflow, ctx: CompileContext, body?: JsxNode[]): CompileResult {
  const errors: ValidationError[] = [];
  const kinds = new Map<string, 'import' | 'scalar' | 'table' | 'query' | 'mutation'>();
  for (const i of flow.imports) kinds.set(i.name.toLowerCase(), 'import');
  for (const v of flow.values) kinds.set(v.name.toLowerCase(), v.kind === 'scalar' ? 'scalar' : 'table');
  for (const q of flow.queries) kinds.set(q.name.toLowerCase(), 'query');
  for (const m of flow.mutations) kinds.set(m.name.toLowerCase(), 'mutation');
  const types = scalarTypes(flow);

  // Imports: a dataset's tables, or a folder's listing, under the import's name.
  const imports: CompiledImport[] = [];
  for (const i of flow.imports) {
    const source = ctx.sources[i.ref];
    if (!source) errors.push(at(i, 'Import', `<Import name="${i.name}" src="ref:${i.ref}"> — ref:${i.ref} is not a dataset or folder you can read`, 'src'));
    else if (source.kind === 'postgres') errors.push(at(i, 'Import', `<Import name="${i.name}"> — ref:${i.ref} is a connected Postgres database, which is never imported: run the query inside it with <Query name="…" source="ref:${i.ref}">`, 'src'));
    else imports.push({ name: i.name, ref: i.ref, tables: source.tables.map((t) => ({ name: t.name, columns: t.columns })) });
  }
  const importKinds = new Map(flow.imports.map((i) => [i.name.toLowerCase(), ctx.sources[i.ref]?.kind]));

  /** A user picker inherits its type and constraints from the user column it draws from. */
  const picked = (v: Extract<Dataflow['values'][number], { kind: 'scalar' }>) => {
    if (!v.source) return v.constraints;
    const column = ctx.sources[v.source]?.tables.find((t) => t.name === 'rows')?.columns.find((c) => c.name === v.column);
    if (column?.type !== 'user') errors.push(at(v, 'Value', `<Value name="${v.name}"> must bind an available user column — ref:${v.source} has no user column ${v.column}`, 'column'));
    return column?.constraints;
  };
  const values: CompiledValue[] = flow.values.map((v) => v.kind === 'scalar'
    ? (() => { const constraints = picked(v); return { name: v.name, kind: 'scalar' as const, type: v.type, default: v.default, ...(v.url === false ? { url: false as const } : {}), ...(v.source ? { source: v.source, column: v.column } : {}), ...(constraints ? { constraints } : {}) }; })()
    // Only the DatasetColumn contract: the parser admits extra authored column properties.
    : { name: v.name, kind: 'table', type: 'table', default: null, rows: v.rows, columns: v.columns.map(({ name, type, constraints }) => ({ name, type, ...(constraints ? { constraints } : {}) })) });
  const tableValues = new Set(flow.values.filter((v) => v.kind === 'table').map((v) => v.name.toLowerCase()));

  const base: Relation[] = [
    ...imports.flatMap((i) => i.tables.map((t) => ({ schema: i.name, table: t.name, columns: t.columns }))),
    ...flow.values.flatMap((v) => (v.kind === 'table' ? [{ schema: 'main', table: v.name, columns: v.columns }] : [])),
    ...(Object.entries(BUILTIN_TABLES) as Array<[BuiltinTable, { columns: DatasetColumn[] }]>).map(([table, t]) => ({ schema: 'main', table, columns: t.columns })),
  ];

  /** Why a name a statement read as a table is not one it may read — or null for a declared query. */
  const missingTable = (raw: string): string => {
    const name = raw.replace(/^main\./i, '');
    const [schema, table] = name.includes('.') ? name.split('.', 2) as [string, string] : [null, name];
    const kind = kinds.get((schema ?? table).toLowerCase());
    if (schema && kind === 'import') {
      const i = imports.find((x) => x.name.toLowerCase() === schema.toLowerCase());
      return `reads ${name} — ${schema} has no table ${table}${i ? ` (it has ${i.tables.map((t) => t.name).join(', ') || 'no tables'})` : ''}`;
    }
    if (schema?.toLowerCase() === 'public') return `reads ${name} — source= with public.rows is removed: <Import name="…" src="ref:<id>" /> the dataset and read <name>.${table}`;
    if (/^ref_[A-Za-z0-9]{6,12}$/i.test(table)) return `reads ${table} — ref_<id> tables are removed: <Import name="…" src="ref:${table.slice(4)}" /> and read <name>.rows`;
    if (table.toLowerCase() === '_signals') return 'reads _signals, which is removed — bind the page value itself ($name), and set values with set= on a Button';
    if (kind === 'scalar') return `reads ${table} as a table, but it is a scalar <Value> — bind it as $${table}`;
    if (kind === 'mutation') return `reads ${table} as a table, but it is a <Mutation>`;
    if (kind === 'import') return `reads ${table} as a table, but it is an <Import> — read its tables: ${table}.rows`;
    return `reads ${name} — no such table: declare it (<Query name="${table}">, <Value name="${table}" type="table">) or <Import> it`;
  };

  /** What a statement's analysis reads, by kind; errors for anything it may not bind. */
  const readsOf = (analysis: StatementAnalysis, fields: Map<string, string>, statement: 'query' | 'mutation', span: Span, tag: string, name: string): { reads: CompiledReads; params: string[]; args: string[] } => {
    const reads: CompiledReads = { imports: [], queries: [], values: [], builtins: [] };
    const add = <K extends keyof CompiledReads>(k: K, v: CompiledReads[K][number]) => { if (!(reads[k] as string[]).includes(v)) (reads[k] as string[]).push(v); };
    for (const r of analysis.reads) {
      const schema = r.schema.toLowerCase(), table = r.table.toLowerCase();
      if (schema !== 'main' && schema !== 'temp') { const i = imports.find((x) => x.name.toLowerCase() === schema); if (i) add('imports', i.name); continue; }
      if (isBuiltinTable(table)) add('builtins', table);
      else if (tableValues.has(table)) add('values', flow.values.find((v) => v.name.toLowerCase() === table)!.name);
      else { const q = flow.queries.find((x) => x.name.toLowerCase() === table); if (q) add('queries', q.name); }
    }
    const params: string[] = [], args: string[] = [];
    for (const sqlName of analysis.params) {
      const logical = fields.get(sqlName) ?? sqlName;
      params.push(logical);
      if (logical.startsWith('_')) {
        const builtin = builtinInput(logical);
        if (logical === VIEWER) errors.push(at(span, tag, `<${tag} name="${name}"> binds $_me, the reader as a row — bind its id: $${VIEWER_ID} (or join the one-row table _me)`));
        else if (!builtin) errors.push(at(span, tag, `<${tag} name="${name}"> binds $${logical}, which is not a built-in — the built-ins are $_me.id, $_now, $_tz, and in a <Mutation> $_row.<column> and $_value`));
        else if (statement === 'query' && !builtin.query) errors.push(at(span, tag, `<${tag} name="${name}"> binds $${logical} — only a <Mutation> reads ${builtin.name === '_row' ? 'the row its control sits in' : 'the value an editing cell holds'}; a query reads page values ($name)`));
        else if (builtin.name === '_row' && !rowField(logical)) errors.push(at(span, tag, `<${tag} name="${name}"> binds $_row — name the field: $_row.<column>`));
        else add('builtins', logical as BuiltinInput);
        continue;
      }
      const kind = kinds.get(logical.toLowerCase());
      if (kind === 'scalar') add('values', flow.values.find((v) => v.name.toLowerCase() === logical.toLowerCase())!.name);
      else if (kind) errors.push(at(span, tag, `<${tag} name="${name}"> binds $${logical}, but "${logical}" is ${kind === 'import' ? 'an <Import>' : kind === 'mutation' ? 'a <Mutation>' : 'a table'} — $params bind scalar values; read a table by its name (… from ${kind === 'import' ? `${logical}.rows` : logical} …)`));
      else if (statement === 'query') errors.push(at(span, tag, `<${tag} name="${name}"> binds $${logical}, which is not a declared <Value> — declare <Value name="${logical}" type="…" />`));
      if (statement === 'mutation' && (!kind || kind === 'scalar')) args.push(logical);
    }
    for (const f of analysis.functions) {
      if (CLOCK_FUNCTIONS.has(f)) errors.push(at(span, tag, `<${tag} name="${name}"> calls ${f} — the current time is the built-in $_now (UTC; the reader's zone is $_tz), identical wherever the statement runs`));
    }
    return { reads, params, args };
  };

  // ── queries, depth-first ────────────────────────────────────────────────
  const compiledQueries = new Map<string, CompiledQuery>();
  const analyses = new Map<string, StatementAnalysis>();
  const failed = new Set<string>();
  const byName = new Map(flow.queries.map((q) => [q.name.toLowerCase(), q]));
  const queryRelations = (): Relation[] => [...compiledQueries.values()].map((q) => ({ schema: 'main', table: q.name, columns: q.columns.map((c) => ({ name: c.name, type: c.type ?? 'string' })) }));

  const compileQuery = (q: QueryDecl, path: QueryDecl[]): void => {
    const key = q.name.toLowerCase();
    if (compiledQueries.has(key) || failed.has(key)) return;
    const fail = (message: string) => { failed.add(key); errors.push(at(q, QUERY_TAG, `<Query name="${q.name}"> ${message}`)); };
    const { sql, fields, now, branches } = rewriteBuiltinFields(q.sql);
    if (q.source) return compilePostgres(q, sql, fields);
    for (;;) {
      let analysis: StatementAnalysis;
      try { analysis = ctx.engine.analyze(sql, [...base, ...queryRelations()]); }
      catch (e) {
        const message = errorText(e);
        const missing = /^no such table: (.+)$/.exec(message)?.[1];
        const upstream = missing ? byName.get(missing.replace(/^main\./i, '').toLowerCase()) : undefined;
        if (upstream && !failed.has(upstream.name.toLowerCase())) {
          if (upstream === q) return fail('reads itself — a query cannot depend on its own result');
          const cycle = path.indexOf(upstream);
          if (cycle >= 0) return fail(`reads ${upstream.name}, which reads ${q.name} back — a query cannot depend on its own result (${[...path.slice(cycle), q, upstream].map((p) => p.name).join(' → ')})`);
          compileQuery(upstream, [...path, q]);
          if (compiledQueries.has(upstream.name.toLowerCase())) continue;
          return fail(`reads ${upstream.name}, which does not compile`);
        }
        if (upstream) return fail(`reads ${upstream.name}, which does not compile`);
        if (missing) return fail(missingTable(missing));
        const column = /^no such column: (.+)$/.exec(message)?.[1];
        return fail(column ? `reads ${column} — no such column` : message.replace(/^a <Query>/, '—'));
      }
      if (analysis.kind !== 'select') return fail('writes — a <Query> is one SELECT; a write is a <Mutation>');
      const { reads, params } = readsOf(analysis, fields, 'query', q, QUERY_TAG, q.name);
      if (now && analysis.functions.some((f) => DATE_FUNCTIONS.has(f))) return fail("reads the clock with 'now' — the current time is the built-in $_now (UTC; the reader's zone is $_tz)");
      analyses.set(key, analysis);
      compiledQueries.set(key, {
        name: q.name, engine: 'sqlite', sql, params, reads,
        columns: compoundTypes(analysis.columns.map((c) => ({ name: c.name, type: originType(c) })), branches),
        start: q.start, end: q.end,
      });
      return;
    }
  };

  /**
   * A compound (UNION, INTERSECT, EXCEPT) answers its LEFT branch's origin for
   * every column, so a `user` column can leak in from one branch while another
   * projects plain text. A column keeps its type only where every branch
   * projects that type; where a branch says `user` and another does not, the
   * column is text; any other disagreement is left to the dry run.
   */
  const compoundTypes = (columns: CompiledQuery['columns'], branches: string[] | null): CompiledQuery['columns'] => {
    if (!branches || columns.every((c) => c.type === null)) return columns;
    const each: Array<Array<ColumnType | null>> = [];
    for (const branch of branches) {
      try { each.push(ctx.engine.analyze(branch, [...base, ...queryRelations()]).columns.map(originType)); }
      catch { each.push([]); }
    }
    return columns.map((c, n) => {
      const types = each.map((b) => b[n] ?? null);
      if (types.every((t) => t === c.type)) return c;
      return { ...c, type: types.includes('user') || c.type === 'user' ? 'string' : null };
    });
  };

  /** A projection's type: its origin's declared type, through an earlier query by that query's compiled type. */
  const originType = (c: StatementAnalysis['columns'][number]): ColumnType | null => {
    if (!c.origin) return null;
    if (c.origin.schema.toLowerCase() === 'main') {
      const upstream = compiledQueries.get(c.origin.table.toLowerCase());
      if (upstream) return upstream.columns.find((u) => u.name.toLowerCase() === c.origin!.column.toLowerCase())?.type ?? null;
    }
    return c.declaredType;
  };

  const compilePostgres = (q: QueryDecl, sql: string, fields: Map<string, string>): void => {
    const key = q.name.toLowerCase();
    const fail = (message: string) => { failed.add(key); errors.push(at(q, QUERY_TAG, `<Query name="${q.name}" source="ref:${q.source}">: ${message}`, 'source')); };
    const source = ctx.sources[q.source!];
    if (!source) return fail(`ref:${q.source} is not a dataset you can read`);
    if (source.kind !== 'postgres') return fail(`source= is only for a connected Postgres dataset, and ref:${q.source} is stored — <Import name="…" src="ref:${q.source}" /> it and read <name>.rows`);
    const shape = ctx.postgres[postgresKey(q)];
    if (!shape) return fail('the connected database was not reached');
    if ('error' in shape) return fail(shape.error);
    const analysis: StatementAnalysis = { kind: 'select', reads: [], writes: [], functions: [], params: shape.params, columns: [] };
    const { reads, params } = readsOf(analysis, fields, 'query', q, QUERY_TAG, q.name);
    compiledQueries.set(key, { name: q.name, engine: 'postgres', source: q.source!, sql, params, reads, columns: shape.columns.map((c) => ({ name: c.name, type: c.type })), start: q.start, end: q.end });
  };

  for (const q of flow.queries) compileQuery(q, []);

  // Dependency order: a query after every query it reads (authored order otherwise).
  const ordered: CompiledQuery[] = [];
  const placed = new Set<string>();
  const place = (q: CompiledQuery) => {
    if (placed.has(q.name)) return;
    placed.add(q.name);
    for (const u of q.reads.queries) { const up = compiledQueries.get(u.toLowerCase()); if (up) place(up); }
    ordered.push(q);
  };
  for (const q of flow.queries) { const c = compiledQueries.get(q.name.toLowerCase()); if (c) place(c); }

  // ── output types the projections could not give: the dry run's values ────
  if (!errors.length) typeFromDryRun(ctx, ordered, imports, flow, types);

  // ── mutations ───────────────────────────────────────────────────────────
  const mutations: CompiledMutation[] = [];
  for (const m of flow.mutations) {
    const compiled = compileMutation(m);
    if (compiled) mutations.push(compiled);
  }
  function compileMutation(m: MutationDecl): CompiledMutation | null {
    const fail = (message: string) => { errors.push(at(m, MUTATION_TAG, `<Mutation name="${m.name}"> ${message}`)); return null; };
    const { sql, fields, now } = rewriteBuiltinFields(m.sql);
    let analysis: StatementAnalysis;
    try { analysis = ctx.engine.analyze(sql, [...base, ...queryRelations()]); }
    catch (e) {
      const message = errorText(e);
      const missing = /^no such table: (.+)$/.exec(message)?.[1];
      if (missing) return fail(missingTable(missing));
      const column = /^no such column: (.+)$/.exec(message)?.[1];
      return fail(column ? `reads ${column} — no such column` : message.replace(/^a <Mutation>/, '—'));
    }
    if (analysis.kind === 'select') return fail('only reads — a <Mutation> is one INSERT, UPDATE or DELETE; a read is a <Query>');
    const written = [...new Map(analysis.writes.map((w) => [`${w.schema.toLowerCase()}\0${w.table.toLowerCase()}`, w])).values()];
    if (written.length !== 1) return fail(`writes ${written.map((w) => `${w.schema}.${w.table}`).join(' and ')} — a <Mutation> writes exactly one table`);
    const w = written[0]!;
    const schema = w.schema.toLowerCase(), table = w.table.toLowerCase();
    let target: CompiledMutation['target'];
    if (schema !== 'main' && schema !== 'temp') {
      const i = imports.find((x) => x.name.toLowerCase() === schema);
      if (!i) return fail(`writes ${w.schema}.${w.table}, which is not an imported table`);
      if (importKinds.get(schema) === 'folder') return fail(`writes ${i.name}.${w.table} — a folder's listing is read-only`);
      target = { import: i.name, table: i.tables.find((t) => t.name.toLowerCase() === table)?.name ?? w.table };
    } else if (tableValues.has(table)) target = { local: flow.values.find((v) => v.name.toLowerCase() === table)!.name };
    else if (compiledQueries.has(table)) return fail(`writes ${compiledQueries.get(table)!.name}, which is a query — a <Mutation> writes an imported table (<import>.rows) or a table <Value>`);
    else if (isBuiltinTable(table)) return fail(`writes ${table}, which is built in and read-only`);
    else return fail(`writes ${w.table}, which is neither an imported table nor a table <Value>`);
    const { reads, args } = readsOf(analysis, fields, 'mutation', m, MUTATION_TAG, m.name);
    if (reads.queries.length) return fail(`reads the query ${reads.queries.join(', ')} — a <Mutation> reads imported tables, table Values and built-ins; pass what it needs from a query as an argument ($name, args=)`);
    if (now && analysis.functions.some((f) => DATE_FUNCTIONS.has(f))) return fail("reads the clock with 'now' — the current time is the built-in $_now");
    return {
      name: m.name, sql, target,
      args: args.map((name) => ({ name, type: types[name] ?? null })),
      reads,
      ...(m.expectedAffected !== undefined ? { expectedAffected: m.expectedAffected } : {}),
      ...(m.reset?.length ? { reset: m.reset } : {}),
      start: m.start, end: m.end,
    };
  }

  let compiled: CompiledDataflow = { imports, values, queries: ordered, mutations };
  if (body && !errors.length) {
    const bound = checkBindings(compiled, body);
    errors.push(...bound.errors);
    compiled = { ...compiled, mutations: compiled.mutations.map((m) => ({ ...m, ...bound.contexts[m.name] })) };
  }
  return errors.length ? { ok: false, errors } : { ok: true, compiled };
}

/**
 * The dry run: every SQLite query over the document's own data (inline
 * tables, empty imports, the declared defaults, a guest at `ctx.now`). A
 * column the projections left untyped takes the type its values show; one
 * with no values to show stays null.
 */
function typeFromDryRun(ctx: CompileContext, queries: CompiledQuery[], imports: CompiledImport[], flow: Dataflow, types: Record<string, ColumnType>): void {
  const local = queries.filter((q) => q.engine === 'sqlite');
  if (!local.some((q) => q.columns.some((c) => c.type === null))) return;
  const tables: Record<string, { rows: Array<Record<string, unknown>>; columns: DatasetColumn[] }> = {
    _me: { rows: [{ id: null }], columns: BUILTIN_TABLES._me.columns },
    _members: { rows: [], columns: BUILTIN_TABLES._members.columns },
  };
  for (const v of flow.values) if (v.kind === 'table') tables[v.name] = { rows: v.rows, columns: v.columns };
  for (const q of queries) if (q.engine === 'postgres') tables[q.name] = { rows: [], columns: q.columns.map((c) => ({ name: c.name, type: c.type ?? 'string' })) };
  const params: Record<string, Scalar> = { [paramSqlName('_me.id')]: null, _now: ctx.now ?? new Date().toISOString(), _tz: 'UTC' };
  for (const v of flow.values) if (v.kind === 'scalar') params[v.name] = v.default;
  const paramTypes: Record<string, ColumnType> = { ...types, [paramSqlName('_me.id')]: 'user', _now: 'timestamp', _tz: 'string' };
  const results = ctx.engine.run({
    tables, imports: Object.fromEntries(imports.map((i) => [i.name, Object.fromEntries(i.tables.map((t) => [t.name, { rows: [], columns: t.columns }]))])),
    queries: local.map((q) => ({ name: q.name, sql: q.sql })), params, paramTypes,
  }, { limit: 1000, pageLimit: 1000, timeoutMs: 2000 });
  for (const q of local) {
    const result = results[q.name];
    if (!result || isQueryFailure(result)) continue;
    q.columns = q.columns.map((c) => {
      if (c.type !== null) return c;
      const seen = result.rows.some((r) => r[c.name] !== null && r[c.name] !== undefined);
      return { ...c, type: seen ? result.columns.find((r) => r.name === c.name)?.type ?? null : null };
    });
  }
}

/**
 * The markup that binds the compiled record: every `run=` can fill its
 * mutation's arguments (from `args=` or a page value of the same name) and
 * sits where its built-ins exist (a row for `$_row.x`, an editing cell for
 * `$_value`); every `args=` names real arguments; every `set=` sets declared
 * scalar Values to values of their type; row fields exist in their table.
 */
export function checkBindings(flow: CompiledDataflow, body: JsxNode[]): { errors: ValidationError[]; contexts: Record<string, Pick<CompiledMutation, 'rowTypes' | 'valueType'>> } {
  const errors: ValidationError[] = [];
  /** What each mutation's controls supply, typed where they sit; one mutation run from two places must agree. */
  const contexts: Record<string, Pick<CompiledMutation, 'rowTypes' | 'valueType'>> = {};
  const supply = (m: CompiledMutation, rowTypes: Record<string, ColumnType | null> | undefined, valueType: ColumnType | null | undefined, where: { tag: string; attr: string; start: number; end: number }) => {
    const next = { ...(rowTypes ? { rowTypes } : {}), ...(valueType !== undefined ? { valueType } : {}) };
    if (!Object.keys(next).length) return;
    const prior = contexts[m.name];
    if (prior && JSON.stringify(prior) !== JSON.stringify(next)) errors.push({ message: `<${where.tag} run="$${m.name}"> — ${m.name} runs from rows of different shapes; one mutation reads one kind of row`, ...where });
    else contexts[m.name] = next;
  };
  const columns: Record<string, DatasetColumn[]> = {};
  for (const q of flow.queries) columns[q.name] = q.columns.map((c) => ({ name: c.name, type: c.type ?? 'string' }));
  for (const v of flow.values) if (v.kind === 'table') columns[v.name] = v.columns ?? [];
  const scopes = analyzeRowScopes(body, columns);
  errors.push(...scopes.errors.map((message) => ({ message })));
  const scalars = new Map(flow.values.flatMap((v) => (v.kind === 'scalar' && v.type !== 'table' ? [[v.name, v.type] as const] : [])));
  const mutations = new Map(flow.mutations.map((m) => [m.name, m]));
  const typed = (table: string | undefined, field: string): ColumnType | null => {
    if (!table) return null;
    const q = flow.queries.find((x) => x.name === table);
    return q ? q.columns.find((c) => c.name === field)?.type ?? null : flow.values.find((v) => v.name === table)?.columns?.find((c) => c.name === field)?.type ?? null;
  };
  const visit = (nodes: JsxNode[], row: string | undefined, cell: boolean, column: string | undefined) => {
    for (const n of nodes) {
      if (n.type !== 'element') continue;
      let scope = row, editing = cell, cellColumn = column;
      const attr = (name: string) => n.attributes.find((a) => a.name === name);
      if (n.tag === 'For') { const each = attr('each')?.value; scope = each && !each.static && each.reactive?.kind === 'signal' ? each.reactive.name : undefined; editing = false; }
      if (n.tag === 'DataTable') { const data = attr('data')?.value; scope = data?.static ? refName(data.json) ?? undefined : undefined; editing = false; }
      if (n.tag === 'Column') { editing = true; const col = attr('col')?.value; cellColumn = col?.static && typeof col.json === 'string' ? col.json : undefined; }
      const set = attr(SET_ATTR), args = attr(ARGS_ATTR), run = attr('run');
      const runName = run?.value.static ? refName(run.value.json) : null;
      const where = (a: { start: number; end: number }, name: string) => ({ tag: n.tag, attr: name, start: a.start, end: a.end });
      if (set) {
        const map = set.value.static ? bindingMap(set.value.json) : null;
        if (n.tag !== 'Button') errors.push({ message: `set= belongs on a <Button> — it sets page values on click`, ...where(set, SET_ATTR) });
        else if (!map) errors.push({ message: `<Button set={{…}}> takes a flat object: {"value": "$other" | "$_row.column" | literal, …}`, ...where(set, SET_ATTR) });
        else for (const [key, source] of Object.entries(map)) {
          const type = scalars.get(key);
          if (!type) continue; // an undeclared or non-scalar key is named by validateDataflow
          const sourceType = 'literal' in source ? null : rowField(source.ref) ? typed(scope, rowField(source.ref)!) : scalars.get(source.ref) ?? builtinInput(source.ref)?.type ?? null;
          if ('literal' in source ? !scalarMatches(source.literal, type) : sourceType !== null && sourceType !== type && !(type === 'string' && sourceType !== 'boolean'))
            errors.push({ message: `<Button set={{"${key}": ${JSON.stringify('literal' in source ? source.literal : `$${source.ref}`)}}}> — ${key} is a ${type}, and that is ${'literal' in source ? 'not one' : `a ${sourceType}`}`, ...where(set, SET_ATTR) });
          if ('ref' in source && rowField(source.ref) && !scope) errors.push({ message: `<Button set={{"${key}": "$${source.ref}"}}> reads a row field outside a row — $_row.<column> belongs inside a <For> or a DataTable <Column>`, ...where(set, SET_ATTR) });
        }
      }
      if (runName) {
        const m = mutations.get(runName);
        const map = args ? (args.value.static ? bindingMap(args.value.json) : null) : {};
        if (args && !map) errors.push({ message: `args= takes a flat object: {"argument": "$value" | "$_row.column" | literal, …}`, ...where(args, ARGS_ATTR) });
        if (m && map) {
          for (const key of Object.keys(map)) if (!m.args.some((a) => a.name === key)) errors.push({ message: `<${n.tag} run="$${m.name}" args={{"${key}": …}}> — ${m.name} takes no argument ${key}${m.args.length ? ` (it takes ${m.args.map((a) => a.name).join(', ')})` : ''}`, ...where(args!, ARGS_ATTR) });
          for (const a of m.args) if (!Object.hasOwn(map, a.name) && !scalars.has(a.name)) errors.push({ message: `<${n.tag} run="$${m.name}"> cannot fill $${a.name} — declare <Value name="${a.name}" …/> or pass it: args={{"${a.name}": …}}`, ...where(run!, 'run') });
          const fields = m.reads.builtins.flatMap((b) => rowField(b) ?? []);
          const edits = m.reads.builtins.includes('_value') && editing && n.tag !== 'Button';
          supply(m, fields.length && scope ? Object.fromEntries(fields.map((f) => [f, typed(scope, f)])) : undefined, edits ? typed(scope, cellColumn ?? '') : undefined, { tag: n.tag, attr: 'run', start: run!.start, end: run!.end });
          for (const b of m.reads.builtins) {
            const field = typeof b === 'string' ? rowField(b) : null;
            if (field && !scope) errors.push({ message: `<${n.tag} run="$${m.name}"> — ${m.name} reads $${b}, the row its control sits in: put the control inside a <For> or a DataTable <Column>`, ...where(run!, 'run') });
            else if (field && columns[scope!] && !columns[scope!]!.some((c) => c.name === field)) errors.push({ message: `<${n.tag} run="$${m.name}"> — ${m.name} reads $${b}, but $${scope} has no column ${field}`, ...where(run!, 'run') });
            if (b === '_value' && (!editing || n.tag === 'Button')) errors.push({ message: `<${n.tag} run="$${m.name}"> — ${m.name} reads $_value, the value an editing cell holds: run it from an editor inside a DataTable <Column>`, ...where(run!, 'run') });
          }
          for (const source of Object.values(map)) if ('ref' in source && rowField(source.ref) && !scope) errors.push({ message: `<${n.tag} run="$${m.name}" args={…}> reads $${source.ref} outside a row — $_row.<column> belongs inside a <For> or a DataTable <Column>`, ...where(args!, ARGS_ATTR) });
        }
      } else if (args) errors.push({ message: `args= goes beside run="$mutation" — it fills that mutation's arguments`, ...where(args, ARGS_ATTR) });
      visit(n.children, scope, editing, cellColumn);
    }
  };
  visit(body, undefined, false, undefined);
  return { errors, contexts };
}

/** Compile a document with nothing but the loader in hand. */
export async function compileWithLoader(flow: Dataflow, load: SchemaLoader, body?: JsxNode[]): Promise<CompileResult> {
  return compileDataflow(flow, await prepareCompile(flow, load), body);
}

