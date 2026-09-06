/**
 * The wire shape both query endpoints accept: `{ values?, only? }` — the
 * reader's current scalars (unknown names are ignored downstream, non-scalar
 * values are refused here) and the queries to run. Shared by the document's
 * own GET (`?q=`), the page relay's POST and the editor's draft path, so the
 * three cannot drift.
 */
import { json } from '@/lib/http';
import { MAX_QUERY_ROWS } from '@/lib/config';
import type { Scalar, Row } from './dataflow';
import { parseLocalTables } from './local-tables';

export interface QueryRequest {
  localTables?: Record<string, Row[]>;
  values?: Record<string, Scalar>;
  only?: string[];
  /** A window of one query's result (lib/sql/engine QueryPage). */
  page?: { name: string; offset: number; limit: number; sort?: { col: string; dir: 'asc' | 'desc' } };
}

const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

export function parseQueryRequest(body: Record<string, unknown>): QueryRequest | Response {
  const out: QueryRequest = {};
  if (body.localTables !== undefined) {
    try { out.localTables = parseLocalTables(body.localTables); }
    catch { return json({error: 'invalid_local_state'}, 400); }
  }
  if (body.values !== undefined) {
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      return json({ error: 'invalid_values', details: ['values must be an object of scalars'] }, 400);
    }
    for (const [k, v] of Object.entries(body.values as Record<string, unknown>)) {
      if (!isScalar(v)) return json({ error: 'invalid_values', details: [`value "${k}" must be a string, number, boolean or null`] }, 400);
    }
    out.values = body.values as Record<string, Scalar>;
  }
  if (body.only !== undefined) {
    if (!Array.isArray(body.only) || body.only.some((n) => typeof n !== 'string')) {
      return json({ error: 'invalid_only', details: ['only must be an array of query names'] }, 400);
    }
    out.only = body.only as string[];
  }
  if (body.page !== undefined) {
    const p = body.page as Record<string, unknown> | null;
    const okSort = p?.sort === undefined || (p?.sort && typeof p.sort === 'object'
      && typeof (p.sort as { col?: unknown }).col === 'string' && ['asc', 'desc'].includes((p.sort as { dir?: string }).dir ?? ''));
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || typeof p.offset !== 'number' || typeof p.limit !== 'number'
      || p.offset < 0 || p.limit < 1 || p.limit > MAX_QUERY_ROWS || !okSort) {
      return json({ error: 'invalid_page', details: [`page must be {name, offset ≥ 0, limit 1..${MAX_QUERY_ROWS}, sort?: {col, dir: asc|desc}}`] }, 400);
    }
    out.page = { name: p.name, offset: p.offset, limit: p.limit, ...(p.sort ? { sort: p.sort as { col: string; dir: 'asc' | 'desc' } } : {}) };
  }
  return out;
}
