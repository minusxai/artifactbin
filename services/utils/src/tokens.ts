import { createHash } from 'node:crypto';
import type { TokenReader, TokenReaderOptions, TokenRecord } from '@artifactbin/contracts';

/** The shape of a presented bearer token. Checked before anything is hashed or queried. */
export const TOKEN_RE = /^mx_[A-Za-z0-9_-]{40,50}$/;
export const hashToken = (presented: string): string => createHash('sha256').update(presented).digest('hex');

/**
 * SELECT id, user_id, audience, scope, expires_at FROM <schema>.tokens WHERE token_hash = $1 AND deleted_at IS NULL   -- byToken
 * SELECT id, user_id, audience, scope, expires_at FROM <schema>.tokens WHERE id = $1        AND deleted_at IS NULL     -- byId
 * Only ever SELECT: the caller's role has that grant and no other. Cached by hash and by id with a positive
 * TTL (5 s) and a shorter negative one (1 s); insertion-ordered eviction past maxEntries (5 000).
 */
export function createTokenReader(o: TokenReaderOptions): TokenReader {
  const ttlMs = o.ttlMs ?? 5000;
  const negativeTtlMs = o.negativeTtlMs ?? 1000;
  const maxEntries = o.maxEntries ?? 5000;
  const now = o.now ?? Date.now;
  const schema = o.schema ? identifier(o.schema, 'schema') : '';

  /** Insertion-ordered: the first key is the oldest, which is what eviction removes. */
  const cache = new Map<string, { at: number; ttl: number; value: TokenRecord | null }>();
  const remember = (key: string, value: TokenRecord | null, expiresAt: number | null = null) => {
    const at = now();
    cache.delete(key); // a re-set entry is young again
    const ttl = value ? Math.min(ttlMs, expiresAt === null ? ttlMs : Math.max(0, expiresAt - at)) : negativeTtlMs;
    cache.set(key, { at, ttl, value });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  };
  const recall = (key: string): { hit: boolean; value: TokenRecord | null } => {
    const entry = cache.get(key);
    if (!entry) return { hit: false, value: null };
    if (now() - entry.at >= entry.ttl) { cache.delete(key); return { hit: false, value: null }; }
    return { hit: true, value: entry.value };
  };

  const read = async (sql: string, param: unknown): Promise<{ value: TokenRecord | null; expiresAt: number | null }> => {
    const { rows } = await o.db.query<{ id: string; user_id: string | null; audience?: string | null; scope?: string | null; expires_at: string | Date | number | null }>(sql, [param]);
    const row = rows[0];
    if (!row) return { value: null, expiresAt: null };
    const expiresAt = row.expires_at === null ? null : new Date(row.expires_at).getTime();
    return {
      value: {
        id: row.id,
        userId: row.user_id ?? null,
        ...(row.audience ? { audience: row.audience } : {}),
        ...(row.scope ? { scope: row.scope } : {}),
      },
      expiresAt,
    };
  };
  const table = `${schema ? `${schema}.` : ''}tokens`;
  const liveClause = 'AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now())';
  const byHashSql = `SELECT id, user_id, audience, scope, expires_at FROM ${table} WHERE token_hash = $1 ${liveClause}`;
  const byIdSql = `SELECT id, user_id, audience, scope, expires_at FROM ${table} WHERE id = $1 ${liveClause}`;

  return {
    async byToken(presented: string): Promise<TokenRecord | null> {
      // The shape check comes FIRST: a guess never reaches the hash, the DB, or the cache.
      if (!TOKEN_RE.test(presented)) return null;
      const key = `h:${hashToken(presented)}`;
      const cached = recall(key);
      if (cached.hit) return cached.value;
      const { value, expiresAt } = await read(byHashSql, key.slice(2));
      remember(key, value, expiresAt);
      return value;
    },
    async byId(id: string): Promise<TokenRecord | null> {
      const key = `i:${id}`;
      const cached = recall(key);
      if (cached.hit) return cached.value;
      const { value, expiresAt } = await read(byIdSql, id);
      remember(key, value, expiresAt);
      return value;
    },
    invalidate(id?: string): void {
      if (id === undefined) { cache.clear(); return; }
      cache.delete(`i:${id}`);
      // A revoked id's hash entry would keep answering for its TTL — drop every entry that resolves to it.
      for (const [key, entry] of cache) if (entry.value?.id === id) cache.delete(key);
    },
  };
}

/** It goes into the SQL text, so only a plain lowercase identifier is admitted. */
function identifier(value: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`${what} must be a plain lowercase identifier, got "${value}"`);
  return value;
}
