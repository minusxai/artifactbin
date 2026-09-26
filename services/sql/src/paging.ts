/**
 * THE PAGINATION WRAPPER: the author's statement as a subquery, ordered by
 * the requested column and cut with LIMIT/OFFSET.
 */
import type { QueryPage, SqlQuery } from '@artifactbin/contracts';

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

// The three literal pieces `pagedQuery` (below) assembles a window from.
const PAGED_HEAD = 'SELECT * FROM (';
const PAGED_MARK = ') AS _q';
const PAGED_ORDER = ' ORDER BY ';

/**
 * The wrapped form of a query for a window: the author's SQL as a subquery,
 * ordered by the requested column (quoted — an identifier, never interpolated
 * text) and cut with LIMIT/OFFSET. `$params` inside still bind. Only applied
 * when the sort column exists in the result — checked by preparing the bare
 * query first, so a bad column is ignored, not an error a reader sees.
 */
export function pagedQuery(query: SqlQuery, page: QueryPage): SqlQuery {
  const order = page.sort ? `${PAGED_ORDER}${quoteIdent(page.sort.col)} ${page.sort.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST` : '';
  return { ...query, sql: `${PAGED_HEAD}${query.sql}${PAGED_MARK}${order} LIMIT ${Math.trunc(page.limit)} OFFSET ${Math.trunc(page.offset)}` };
}

