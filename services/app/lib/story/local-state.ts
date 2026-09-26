import { isQueryFailure, type ColumnType, type MutationInput, type Scalar, type SqlService } from '@artifactbin/contracts';
import type { CompiledDataflow, CompiledMutation } from './compiled-dataflow';
import type { TableResult } from './dataflow';
import { checkedLocalRows } from './local-tables';

export interface LocalMutationResult {
  target: string;
  table: TableResult;
  affected: number;
}

/**
 * A write to a local table Value, against the reader's current rows with
 * declaration-owned types. No storage, credentials, dataset loading or commit:
 * the browser commits the returned snapshot only if its originating state
 * revision still applies.
 */
export async function runLocalStateMutation(
  flow: CompiledDataflow,
  mutation: CompiledMutation,
  snapshot: { tables: Record<string, TableResult> },
  engine: Pick<SqlService, 'mutate'>,
  bound: { params: Record<string, Scalar>; paramTypes: Record<string, ColumnType>; reads?: MutationInput['reads'] },
): Promise<LocalMutationResult> {
  if (!('local' in mutation.target)) throw new Error('Mutation must target a declared local table');
  const target = mutation.target.local;
  const declaration = flow.values.find((v) => v.kind === 'table' && v.name === target);
  if (!declaration) throw new Error('Mutation must target a declared local table');
  const columns = declaration.columns ?? [];
  if (!columns.length) throw new Error('Local table needs declared columns');
  const rows = Object.hasOwn(snapshot.tables, target) ? snapshot.tables[target]!.rows : declaration.rows ?? [];
  const result = await engine.mutate({
    table: { name: target, columns, rows: checkedLocalRows(rows, columns) }, sql: mutation.sql,
    params: bound.params, paramTypes: bound.paramTypes, ...(bound.reads?.length ? { reads: bound.reads } : {}),
    ...(mutation.expectedAffected === undefined ? {} : { expectedAffected: mutation.expectedAffected }),
  });
  if (isQueryFailure(result)) throw new Error(result.error);
  return { target, table: { columns: result.columns, rows: result.rows }, affected: result.affected };
}
