import {json} from './http';

export function encodeCursor(kind: string, position: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({v: 1, kind, position})).toString('base64url');
}

/** Cursor shapes are owned here so malformed input never reaches SQL casts. */
export function decodePage(input: Record<string, unknown>, kind: 'artifacts' | 'versions' | 'comments'):
  {limit: number; cursor?: Record<string, unknown>} | Response {
  const limit = input.limit === undefined ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json({error: 'invalid_limit', hint: 'limit must be an integer from 1 to 100'}, 400);
  if (input.cursor === undefined) return {limit};
  try {
    if (typeof input.cursor !== 'string' || input.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
    if (value.v !== 1 || value.kind !== kind || !value.position) throw new Error();
    const p = value.position;
    if (kind === 'versions') {
      if (!Number.isSafeInteger(p.version) || p.version < 1) throw new Error();
    } else if (kind === 'comments') {
      if (typeof p.seq !== 'string' || !/^[0-9]{1,18}$/.test(p.seq)) throw new Error();
    } else if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(p.id) ||
      typeof p.created !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(p.created) || !Number.isFinite(Date.parse(p.created))) throw new Error();
    return {limit, cursor: p};
  } catch { return json({error: 'invalid_cursor', hint: 'Use next_cursor from the same listing endpoint'}, 400); }
}
