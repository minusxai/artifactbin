/**
 * The wire shape of a WRITE: `{ mutation, values? }` — the NAME of a mutation
 * the document declares, plus the reader's current scalars. The twin of
 * lib/story/query-request, and narrow for the same reason: the only thing a
 * caller supplies is data, never SQL.
 *
 * Shared by the document's own POST and the page relay, so the two cannot
 * drift.
 */
import { json } from '@/lib/http';
import { DECL_NAME_RE, type Scalar } from './dataflow';

export interface MutationRequest {
  mutation: string;
  values?: Record<string, Scalar>;
  row?: Record<string, Scalar>;
}

const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

export function parseMutationRequest(body: Record<string, unknown>): MutationRequest | Response {
  const name = body.mutation;
  if (typeof name !== 'string' || !DECL_NAME_RE.test(name)) {
    return json({ error: 'invalid_mutation', details: ['mutation must be the name of a <Mutation> the document declares'] }, 400, { 'Access-Control-Allow-Origin': '*' });
  }
  const out: MutationRequest = { mutation: name };
  if (body.values !== undefined) {
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      return json({ error: 'invalid_values', details: ['values must be an object of scalars'] }, 400, { 'Access-Control-Allow-Origin': '*' });
    }
    for (const [k, v] of Object.entries(body.values as Record<string, unknown>)) {
      if (!isScalar(v)) return json({ error: 'invalid_values', details: [`value "${k}" must be a string, number, boolean or null`] }, 400, { 'Access-Control-Allow-Origin': '*' });
    }
    out.values = body.values as Record<string, Scalar>;
  }
  if (body.row !== undefined) {
    if (!body.row || typeof body.row !== 'object' || Array.isArray(body.row)) {
      return json({ error: 'invalid_row', details: ['row must be an object of scalars'] }, 400, { 'Access-Control-Allow-Origin': '*' });
    }
    for (const [k, v] of Object.entries(body.row as Record<string, unknown>)) {
      if (!DECL_NAME_RE.test(k) || !isScalar(v)) return json({ error: 'invalid_row', details: [`row field "${k}" must be a named scalar`] }, 400, { 'Access-Control-Allow-Origin': '*' });
    }
    out.row = body.row as Record<string, Scalar>;
  }
  return out;
}
