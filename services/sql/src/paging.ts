/**
 * THE PAGINATION WRAPPER, shared by both engines: the author's statement as a
 * subquery, ordered by the requested column and cut with LIMIT/OFFSET, and
 * the inverse that recovers the author's SQL from it.
 */
import type { QueryPage, SqlQuery } from '@artifactbin/contracts';

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

// The three literal pieces `pagedQuery` (below) assembles a window from.
const PAGED_HEAD = 'SELECT * FROM (';
const PAGED_MARK = ') AS _q';
const PAGED_ORDER = ' ORDER BY ';

/** ` LIMIT <n> OFFSET <n>`, and nothing after it. A split, not a pattern: `\d+` inside a scan is where a polynomial blow-up comes from. */
function isPagedTail(sql: string, at: number): boolean {
  const p = sql.slice(at).split(' ');
  const digits = (s: string) => s.length > 0 && !/\D/.test(s);
  return p.length === 5 && p[0] === '' && p[1] === 'LIMIT' && p[3] === 'OFFSET' && digits(p[2]) && digits(p[4]);
}

/**
 * The author's SQL back out of a pagedQuery wrapper (the count and the
 * sort-retry need it); the DuckDB engine calls it, and its regression test
 * is __tests__/unwrap-paged.test.ts. (The SQLite engine keeps the statement
 * text SQLite admitted, so it never needs to take a wrapper apart.)
 *
 * A SCAN, NOT A PATTERN. This was one anchored regex whose `[\s\S]*` and
 * `[\s\S]*?` sat either side of a repeated literal, so a chain of near-misses
 * cost time in the SQUARE of the length (CodeQL js/polynomial-redos; measured
 * 28 ms at 50 KB, 417 ms at 200 KB) — and the input is a document author's
 * SQL. The walk below is the same decision, made in one pass: the tail is
 * fixed by the end anchor, so there is exactly one place it can start, and the
 * greedy `([\s\S]*)` means the LAST `) AS _q` that leaves a valid remainder
 * wins. Behaviour is byte-identical to the pattern it replaced.
 */
export function unwrapPaged(sql: string): string {
  if (!sql.startsWith(PAGED_HEAD)) return sql;
  const tail = sql.lastIndexOf(' LIMIT ');
  if (tail < 0 || !isPagedTail(sql, tail)) return sql;
  for (let i = sql.lastIndexOf(PAGED_MARK, tail - PAGED_MARK.length); i >= PAGED_HEAD.length; i = sql.lastIndexOf(PAGED_MARK, i - 1)) {
    const after = i + PAGED_MARK.length;
    // Either the wrapper's own LIMIT follows the mark directly, or an ORDER BY
    // clause (of any content) sits between the two.
    if (after === tail || (sql.startsWith(PAGED_ORDER, after) && after + PAGED_ORDER.length <= tail)) return sql.slice(PAGED_HEAD.length, i);
  }
  return sql;
}

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

