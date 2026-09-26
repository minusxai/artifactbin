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
import type { ColumnType } from '@artifactbin/contracts';
import { platformValues, rowField, type PlatformInputs } from './builtins';
import type { CompiledDataflow, CompiledMutation } from './compiled-dataflow';
import { bindParams, bindTypes, initialValues, mutationParams } from './compiled-flow';
import { DECL_NAME_RE, scalarMatches, type Row, type Scalar } from './dataflow';
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

export type MutationBinding =
  | { ok: true; params: Record<string, Scalar>; paramTypes: Record<string, ColumnType> }
  | { ok: false; reason: 'invalid_sql' | 'invalid_row'; detail: string };

/**
 * THE SIGNATURE AT THE DOOR — shared by the server's write door
 * (lib/artifacts runDocumentMutation) and the reader's page when it computes a
 * local write itself (lib/story-runtime/page-engine), so a press is judged by
 * one rule wherever it runs.
 *
 * Every argument is typed by the declaration it is filled from, so a value of
 * another JS type is a caller error named here, never a statement for the
 * engine to make sense of. An EMPTY string for anything but text is "no value"
 * — what a cleared input sends, and what `--arg due=` means on a command line;
 * `null` always clears. An argument the mutation does not take is refused by
 * name: nothing a caller sends reaches the statement unless the author's
 * signature asked for it. An argument left out is the page value of that name
 * at its declared default, as a fresh page holds it.
 *
 * The control's context: the fields of its row and the value its cell holds —
 * only what the statement reads, each typed by where the control sits (the
 * row's table, the edited column; CompiledMutation.rowTypes/valueType). A row
 * the table could not have produced is refused by name, as is a cell value the
 * column cannot hold.
 */
export function bindMutationRequest(flow: CompiledDataflow, m: CompiledMutation, request: MutationRequest, platform: PlatformInputs): MutationBinding {
  const invalid = (detail: string): MutationBinding => ({ ok: false, reason: 'invalid_sql', detail });
  const badRow = (detail: string): MutationBinding => ({ ok: false, reason: 'invalid_row', detail });
  const extra = Object.keys(request.args).filter((name) => !m.args.some((a) => a.name === name));
  if (extra.length) return invalid(`${m.name} takes no argument ${extra.join(', ')}${m.args.length ? ` (it takes ${m.args.map((a) => a.name).join(', ')})` : ''}`);
  const logical: Record<string, Scalar> = {};
  const defaults = initialValues(flow);
  for (const a of m.args) {
    const raw = Object.hasOwn(request.args, a.name) ? request.args[a.name]! : defaults[a.name] ?? null;
    const value = raw === '' && a.type && a.type !== 'string' ? null : raw;
    if (a.type && !scalarMatches(value, a.type)) return invalid(`argument $${a.name} does not match its declared type`);
    logical[a.name] = value;
  }
  const fields = m.reads.builtins.flatMap((b) => rowField(b) ?? []);
  const types: Record<string, ColumnType | null> = Object.fromEntries(m.args.map((a) => [a.name, a.type]));
  if (fields.length) {
    const missing = fields.filter((f) => !request.row || !Object.hasOwn(request.row, f));
    if (missing.length) return badRow(`this row mutation reads $_row.${missing.join(', $_row.')} — send the row its control sits in`);
    const extraFields = Object.keys(request.row!).filter((k) => !fields.includes(k));
    if (extraFields.length) return badRow(`the row carries ${extraFields.join(', ')}, which ${m.name} does not read — send only $_row.${fields.join(', $_row.')}`);
    for (const f of fields) {
      const type = m.rowTypes?.[f] ?? null;
      const value = request.row![f]!;
      if (type && !scalarMatches(value, type)) return badRow('row fields and scalar types must match the declared table result');
      logical[`_row.${f}`] = value;
      types[`_row.${f}`] = type;
    }
  } else if (request.row !== undefined) return badRow('this mutation does not read a row');
  if (m.reads.builtins.includes('_value')) {
    if (request.value === undefined) return badRow('cell mutations require value');
    const type = m.valueType ?? null;
    const value = type && type !== 'string' && request.value === '' ? null : request.value;
    if (type && !scalarMatches(value, type)) return badRow('parameter $_value does not match the edited column\'s type');
    logical._value = value;
    types._value = type;
  } else if (request.value !== undefined) return badRow('this mutation does not accept a value');
  Object.assign(logical, platformValues(platform));
  const names = mutationParams(m);
  return { ok: true, params: bindParams(names, logical), paramTypes: bindTypes(names, types) };
}
