/**
 * Which way is better, per metric — the smallest amount of judgement the report
 * can carry and still be readable at a glance.
 *
 * Deliberately partial. `cost_usd` lower is better and saying so helps; but
 * `versions` and `query_rows` are not a contest, and marking a "winner" there
 * would invent a judgement the numbers do not support. Nothing here decides a
 * verdict — the `pass` rows do that. This only points at which column did a
 * given thing more cheaply, and only where "more cheaply" means something.
 */
export type Direction = 'lower' | 'higher';

const LOWER_IS_BETTER = new Set([
  'cost_usd', 'turns', 'tool_calls', 'tokens_in', 'tokens_out', 'total_tokens', 'duration_s',
  'http_calls', 'write_attempts', 'four_xx', 'invented_endpoints', 'docs_read_calls', 'docs_fetches', 'docs_bytes',
]);

export function directionOf(metric: string): Direction | null {
  return LOWER_IS_BETTER.has(metric) ? 'lower' : null;
}

/**
 * Indexes of the best column(s). Empty when there is nothing to say: no
 * direction, fewer than two comparable values, or a dead heat across all of
 * them — a mark on every column is a mark on none.
 */
export function bestColumns(values: Array<number | null | undefined>, direction: Direction | null): number[] {
  if (!direction) return [];
  const present = values
    .map((v, i) => ({ v: typeof v === 'number' && Number.isFinite(v) ? v : null, i }))
    .filter((e): e is { v: number; i: number } => e.v !== null);
  if (present.length < 2) return [];
  const best = direction === 'lower'
    ? Math.min(...present.map((e) => e.v))
    : Math.max(...present.map((e) => e.v));
  const winners = present.filter((e) => e.v === best);
  return winners.length === present.length ? [] : winners.map((e) => e.i);
}
