/**
 * READING A COMPILED DATAFLOW — the pure questions every consumer of
 * `CompiledDataflow` asks: the starting values and inline tables, which
 * queries a run needs, what a statement binds (by SQL name) and how a result
 * is typed. Browser-safe: no engine, no SQL text; the compiler
 * (lib/story/compile-dataflow) has already said what each statement reads.
 */
import { paramSqlName, type ColumnType, type DatasetColumn, type MutationInput } from '@artifactbin/contracts';
import { BUILTIN_TABLES, builtinInput, isBuiltinInput } from './builtins';
import type { CompiledDataflow, CompiledMutation, CompiledQuery } from './compiled-dataflow';
import type { DataflowState, Row, Scalar, TableResult } from './dataflow';

/** Every scalar at its declared default. */
export function initialValues(flow: CompiledDataflow): Record<string, Scalar> {
  return Object.fromEntries(flow.values.flatMap((v) => (v.kind === 'scalar' ? [[v.name, v.default]] : [])));
}

/**
 * The tables a document already HAS: every inline `<Value type="table">`.
 * Their rows are written in the source, so they travel with the declarations
 * and a chart bound to one has its rows without anything running.
 */
export function initialTables(flow: CompiledDataflow): DataflowState['tables'] {
  return Object.fromEntries(flow.values.flatMap((v) => (v.kind === 'table' ? [[v.name, { rows: v.rows ?? [], columns: v.columns ?? [] }]] : [])));
}

/** The declared type of every scalar Value, by name. */
export function valueTypes(flow: CompiledDataflow): Record<string, ColumnType> {
  return Object.fromEntries(flow.values.flatMap((v) => (v.kind === 'scalar' && v.type !== 'table' ? [[v.name, v.type]] : [])));
}

/** The requested queries and everything upstream of them, in run order; all of them when nothing is asked for. */
export function selectQueries(flow: CompiledDataflow, selection: { only?: Iterable<string>; page?: { name: string } } = {}): CompiledQuery[] {
  const roots = selection.page ? [selection.page.name] : selection.only ? [...selection.only] : null;
  if (!roots) return flow.queries;
  const byName = new Map(flow.queries.map((q) => [q.name, q]));
  const wanted = new Set<string>();
  const visit = (name: string) => {
    const q = byName.get(name);
    if (!q || wanted.has(name)) return;
    wanted.add(name);
    for (const upstream of q.reads.queries) visit(upstream);
  };
  for (const name of roots) visit(name);
  return flow.queries.filter((q) => wanted.has(q.name));
}

/** The queries a change to these values makes stale — every query that reads one, and everything downstream — in run order. */
export function queriesReadingValues(flow: CompiledDataflow, names: Iterable<string>): string[] {
  const changed = new Set(names);
  const dirty = new Set<string>();
  for (const q of flow.queries) if (q.reads.values.some((v) => changed.has(v)) || q.reads.queries.some((u) => dirty.has(u))) dirty.add(q.name);
  return flow.queries.filter((q) => dirty.has(q.name)).map((q) => q.name);
}

/** The artifact an import reads, by import name. */
export const importRef = (flow: CompiledDataflow, name: string): string | undefined => flow.imports.find((i) => i.name === name)?.ref;

/** The dataset a mutation writes, or null for a local table. */
export const mutationTargetRef = (flow: CompiledDataflow, m: CompiledMutation): string | null =>
  'import' in m.target ? importRef(flow, m.target.import) ?? null : null;

/**
 * Every artifact the document's DATA depends on: its imports, the connected
 * databases its queries run inside, and the datasets its user pickers draw
 * from — what `meta.refs`, ownership and the live stream need.
 */
export function dataRefs(flow: CompiledDataflow, pickerSources: Iterable<string> = []): string[] {
  return [...new Set([...flow.imports.map((i) => i.ref), ...flow.queries.flatMap((q) => (q.source ? [q.source] : [])), ...pickerSources])];
}

/**
 * A statement's parameters, BY SQL NAME, from logical values: `_me.id` binds
 * as `_me__id` (paramSqlName). Missing values bind NULL. Only the names the
 * statement itself binds travel.
 */
export function bindParams(params: readonly string[], values: Record<string, Scalar | undefined>): Record<string, Scalar> {
  return Object.fromEntries(params.map((logical) => [paramSqlName(logical), values[logical] ?? null]));
}

/** The declared type of each parameter, by SQL name — Values by their declaration, built-ins by the registry. */
export function bindTypes(params: readonly string[], types: Record<string, ColumnType | null | undefined>): Record<string, ColumnType> {
  const out: Record<string, ColumnType> = {};
  for (const logical of params) {
    const type = types[logical] ?? builtinInput(logical)?.type ?? null;
    if (type) out[paramSqlName(logical)] = type;
  }
  return out;
}

/**
 * THE ONE OWNER OF RESULT TYPING. SQLite answers an expression column by what
 * its values already are (a comparison is 1/0, anything else a string when it
 * cannot tell); the compiler recorded what each output column IS. The server
 * and the runtime both pass every result through here, so a `boolean` column
 * reads true/false wherever it was computed, and a column the compiler typed
 * keeps that type even when this run's values could not show it.
 */
export function typedResult(columns: CompiledQuery['columns'], result: TableResult): TableResult {
  const declared = new Map(columns.flatMap((c) => (c.type ? [[c.name, c.type] as const] : [])));
  if (!declared.size) return result;
  const typed: DatasetColumn[] = result.columns.map((c) => {
    const type = declared.get(c.name);
    return type && type !== c.type ? { ...c, type } : c;
  });
  const booleans = typed.filter((c) => c.type === 'boolean').map((c) => c.name);
  const rows = booleans.length
    ? result.rows.map((row) => {
      const out = { ...row };
      for (const name of booleans) if (typeof out[name] === 'number') out[name] = out[name] !== 0;
      return out;
    })
    : result.rows;
  return { ...result, columns: typed, rows };
}

/** An imported artifact's tables by name — `imports.bookings.rows` is `bookings.rows` in SQL. */
export type ImportTables = Record<string, Record<string, { rows: Row[]; columns: DatasetColumn[] }>>;

/** The logical parameters a mutation binds: its arguments and the built-in inputs it reads. */
export const mutationParams = (m: CompiledMutation): string[] => [...m.args.map((a) => a.name), ...m.reads.builtins.filter(isBuiltinInput)];

/**
 * Everything a mutation READS besides the table it writes — the other tables
 * of the imports it names, the table Values and built-in tables it joins — as
 * the engine loads them (MutationInput.reads). Rows come from `data`; a
 * table Value nobody overrode reads its declared rows.
 */
export function mutationReads(flow: CompiledDataflow, m: CompiledMutation, data: { imports?: ImportTables; tables?: Record<string, TableResult>; userId?: string | null; members?: Row[] }): NonNullable<MutationInput['reads']> {
  const out: NonNullable<MutationInput['reads']> = [];
  const writes = (schema: string, table: string) => ('import' in m.target ? m.target.import === schema && m.target.table === table : schema === 'main' && m.target.local === table);
  for (const name of m.reads.imports) {
    const i = flow.imports.find((x) => x.name === name);
    for (const t of i?.tables ?? []) if (!writes(name, t.name)) out.push({ schema: name, table: t.name, rows: data.imports?.[name]?.[t.name]?.rows ?? [], columns: t.columns });
  }
  for (const name of m.reads.values) {
    const v = flow.values.find((x) => x.name === name && x.kind === 'table');
    if (v && !writes('main', v.name)) out.push({ schema: 'main', table: v.name, rows: data.tables?.[v.name]?.rows ?? v.rows ?? [], columns: v.columns ?? [] });
  }
  if (m.reads.builtins.includes('_me')) out.push({ schema: 'main', table: '_me', rows: [{ id: data.userId ?? null }], columns: BUILTIN_TABLES._me.columns });
  if (m.reads.builtins.includes('_members')) out.push({ schema: 'main', table: '_members', rows: data.members ?? [], columns: BUILTIN_TABLES._members.columns });
  return out;
}
