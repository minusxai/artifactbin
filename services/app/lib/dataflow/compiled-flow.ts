/** SQL parameter binding shared by current dataset reads and writes. */
import { paramSqlName, type ColumnType } from '@artifactbin/contracts';
import { builtinInput } from './builtins';
import type { Scalar } from './dataflow';

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
