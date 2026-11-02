/** Bounded legacy named-action request shape, retained for explicit endpoint refusals. */
import { DECL_NAME_RE, type Row, type Scalar } from './dataflow';
import { parseLocalTables } from './local-tables';

export interface MutationRequest {
  operationKey?: string;
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
  const allowed = ['mutation', 'args', 'row', 'value', 'tz', 'localTables', 'operationKey'];
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) return refuse('unknown_mutation_fields', [`Unknown fields: ${unknown.join(', ')}. A write is {"mutation": "<name>", "args": {…}, "row"?: {…}, "value"?: …}; it never carries SQL.`]);
  if(body.operationKey!==undefined&&(typeof body.operationKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(body.operationKey)))return refuse('invalid_idempotency_key', ['operationKey must be 16–128 letters, digits, underscores or hyphens']);
  const name = body.mutation;
  if (typeof name !== 'string' || !DECL_NAME_RE.test(name)) return refuse('invalid_mutation', ['mutation must be the name of a <Mutation> the document declares']);
  const args = body.args === undefined ? {} : scalars(body.args, 'argument', 'invalid_args');
  if (args instanceof Response) return args;
  const out: MutationRequest = { mutation: name, args, ...(body.operationKey?{operationKey:body.operationKey as string}:{}) };
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
