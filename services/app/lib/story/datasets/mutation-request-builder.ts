/** The browser-safe write envelope, without the server's request parser or scalar validation. */
import type { Row, Scalar } from '../data/dataflow';
import { rowField } from '../data/builtins';
import type { CompiledMutation } from '../data/compiled-dataflow';
import type { MutationRequest } from './mutation-request';

export function mutationRequestFor(m: Pick<CompiledMutation, 'name' | 'args' | 'reads'>, input: { values: Record<string, Scalar>; args?: Record<string, Scalar>; row?: Record<string, Scalar>; value?: Scalar; tz?: string; localTables?: Record<string, Row[]> }): MutationRequest {
  const args = Object.fromEntries(m.args.map((a) => [a.name, input.args && Object.hasOwn(input.args, a.name) ? input.args[a.name]! : input.values[a.name] ?? null]));
  const fields = m.reads.builtins.flatMap((b) => rowField(b) ?? []);
  const row = fields.length && input.row ? Object.fromEntries(fields.map((f) => [f, input.row![f] ?? null])) : undefined;
  return {
    mutation: m.name, args,
    ...(row ? { row } : {}),
    ...(m.reads.builtins.includes('_value') && input.value !== undefined ? { value: input.value } : {}),
    ...(input.tz ? { tz: input.tz } : {}),
    ...(input.localTables ? { localTables: input.localTables } : {}),
  };
}
