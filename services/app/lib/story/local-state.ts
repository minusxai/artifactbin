import { isQueryFailure, type SqlService, type MutationInput } from '@artifactbin/contracts';
import { scalarMatches, type Dataflow, type DataflowState, type MutationDecl, type TableResult } from './dataflow';
import { localWriteTarget, SIGNALS_TABLE } from './local-target';
import { checkedLocalRows } from './local-tables';
export { localWriteTarget, SIGNALS_TABLE } from './local-target';

/** A local target is a declared table Value or the reserved scalar projection. */
export type LocalMutation = Pick<MutationDecl, 'sql' | 'target' | 'expectedAffected'>;
export interface LocalMutationResult {
  target: string;
  table: TableResult;
  affected: number;
}

/**
 * Execute against supplied local rows with declaration-owned types. No storage,
 * credentials, dataset loading, or commit: the browser commits the returned
 * snapshot only if its originating state revision still applies.
 */
export async function runLocalStateMutation(
  flow: Dataflow,
  mutation: LocalMutation,
  snapshot: Pick<DataflowState, 'values' | 'tables'>,
  engine: Pick<SqlService, 'mutate'>,
  row?: MutationInput['row'],
): Promise<LocalMutationResult> {
  const target = localWriteTarget(mutation.sql);
  if (!target || target.name !== mutation.target) throw new Error('Local mutation target does not match its declaration');
  const signals = target.name === SIGNALS_TABLE;
  const declaration = flow.values.find(v => v.kind === 'table' && v.name === target.name);
  if (!signals && (!declaration || declaration.kind !== 'table' || target.name.startsWith('ref_'))) {
    throw new Error('Mutation must target a declared local table');
  }
  if (signals && target.operation !== 'update') throw new Error('_signals allows only UPDATE');

  const scalars = flow.values.filter(v => v.kind === 'scalar');
  const values = Object.fromEntries(scalars.map(v => {
    const value = Object.hasOwn(snapshot.values, v.name) ? snapshot.values[v.name] : v.default;
    if (!scalarMatches(value, v.type)) throw new Error(`Signal "${v.name}" has an invalid type`);
    return [v.name, value];
  }));
  const columns = signals
    ? scalars.map(v => ({name: v.name, type: v.type}))
    : declaration!.kind === 'table' ? declaration!.columns : [];
  if (!columns.length) throw new Error('Local table needs declared columns');
  const current = Object.hasOwn(snapshot.tables, target.name) ? snapshot.tables[target.name] : undefined;
  const rows = signals ? [values] : current?.rows ?? (declaration!.kind === 'table' ? declaration!.rows : []);
  const result = await engine.mutate({
    table: {name: target.name, columns, rows: checkedLocalRows(rows, columns)}, sql: mutation.sql,
    params: {...values, ...(row ? {_value: snapshot.values._value} : {})}, ...(row ? {row} : {}),
    ...(mutation.expectedAffected === undefined ? {} : {expectedAffected: mutation.expectedAffected}),
  });
  if (isQueryFailure(result)) throw new Error(result.error);
  if (signals && result.rows.length !== 1) throw new Error('_signals must remain a single row');
  return {target: target.name, table: {columns: result.columns, rows: result.rows}, affected: result.affected};
}
