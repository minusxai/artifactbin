/**
 * The wire shape of a WRITE: `{ mutation, args, row?, value? }` — the NAME of
 * a mutation the document declares, the arguments its signature takes (page
 * values, unless the control's `args=` named other sources), and the context
 * built-ins the control supplies: the row it sits in (`$_row.<column>`) and
 * the value an editing cell holds (`$_value`). The twin of
 * lib/story/query-request, and narrow for the same reason: a caller supplies
 * data, never SQL.
 *
 * ONE definition for every transport — the document's own POST, the page
 * relay, the editor's authenticated path — so they cannot drift. The builder
 * is browser-safe; the parser answers the server's 400s.
 */
import { rowField } from './builtins';
import type { CompiledMutation } from './compiled-dataflow';
import { DECL_NAME_RE, type Row, type Scalar } from './dataflow';
import { parseLocalTables } from './local-tables';

export interface MutationRequest {
  mutation: string;
  /** The mutation's arguments, by name. */
  args: Record<string, Scalar>;
  /** The row the control sits in: only the fields the statement reads (`$_row.<column>`). */
  row?: Record<string, Scalar>;
  /** The new value an editing cell holds (`$_value`). */
  value?: Scalar;
  /** The reader's IANA zone, bound as `$_tz`. */
  tz?: string;
  /** Table Values a local write reads and writes: the reader's current rows. */
  localTables?: Record<string, Row[]>;
}

/**
 * The request a control's press makes: each argument from `args` (what the
 * control's `args=` resolved to) or else the page value of the same name; the
 * row fields and edited value the statement reads, and nothing else.
 */
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

const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

const CORS = { 'Access-Control-Allow-Origin': '*' };
const refuse = (error: string, details: string[]) => Response.json({ error, details }, { status: 400, headers: CORS });

/** A flat object of scalars under names, or the refusal that names what is wrong with it. */
function scalars(value: unknown, what: string, error: string): Record<string, Scalar> | Response {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return refuse(error, [`${what} must be an object of scalars`]);
  for (const [k, v] of Object.entries(value)) {
    if (!DECL_NAME_RE.test(k) || !isScalar(v)) return refuse(error, [`${what} "${k}" must be a named string, number, boolean or null`]);
  }
  return value as Record<string, Scalar>;
}

export function parseMutationRequest(body: Record<string, unknown>): MutationRequest | Response {
  const allowed = ['mutation', 'args', 'row', 'value', 'tz', 'localTables'];
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) return refuse('unknown_mutation_fields', [`Unknown fields: ${unknown.join(', ')}. A write is {"mutation": "<name>", "args": {…}, "row"?: {…}, "value"?: …}; it never carries SQL.`]);
  const name = body.mutation;
  if (typeof name !== 'string' || !DECL_NAME_RE.test(name)) return refuse('invalid_mutation', ['mutation must be the name of a <Mutation> the document declares']);
  const args = body.args === undefined ? {} : scalars(body.args, 'argument', 'invalid_args');
  if (args instanceof Response) return args;
  const out: MutationRequest = { mutation: name, args };
  if (body.row !== undefined) {
    const row = scalars(body.row, 'row field', 'invalid_row');
    if (row instanceof Response) return row;
    out.row = row;
  }
  if (body.value !== undefined) {
    if (!isScalar(body.value)) return refuse('invalid_value', ['value must be a string, number, boolean or null']);
    out.value = body.value;
  }
  if (body.tz !== undefined) {
    if (typeof body.tz !== 'string') return refuse('invalid_tz', ['tz must be an IANA time zone name']);
    out.tz = body.tz;
  }
  if (body.localTables !== undefined) {
    try { out.localTables = parseLocalTables(body.localTables); }
    catch { return Response.json({ error: 'invalid_local_state' }, { status: 400, headers: CORS }); }
  }
  return out;
}
