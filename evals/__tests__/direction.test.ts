/**
 * Which way is better, per metric.
 *
 * Deliberately partial: a metric only gets a direction when one genuinely
 * exists. `cost_usd` lower is better; `versions` and `query_rows` mean nothing
 * as a contest, and marking a "winner" there would invent a judgement the
 * numbers do not support.
 */
import { describe, it, expect } from 'vitest';
import { bestColumns, directionOf } from '../lib/direction';

describe('directionOf', () => {
  it('marks the metrics with an unambiguous direction', () => {
    for (const m of ['cost_usd', 'turns', 'tokens_in', 'tokens_out', 'total_tokens', 'duration_s', 'four_xx', 'invented_endpoints', 'write_attempts', 'http_calls', 'tool_calls']) {
      expect(directionOf(m)).toBe('lower');
    }
    expect(directionOf('query_rows')).toBeNull();
    expect(directionOf('versions')).toBeNull();
    expect(directionOf('title')).toBeNull();
  });
});

describe('bestColumns', () => {
  it('marks the lowest value when lower is better', () => {
    expect(bestColumns([0.08, 0.02, 0.5], 'lower')).toEqual([1]);
  });

  it('marks every column that ties for best, rather than picking one', () => {
    expect(bestColumns([3, 3, 9], 'lower')).toEqual([0, 1]);
  });

  it('marks nothing when there is no direction, one column, or no contest', () => {
    expect(bestColumns([1, 2], null)).toEqual([]);
    expect(bestColumns([5], 'lower')).toEqual([]);
    expect(bestColumns([4, 4, 4], 'lower')).toEqual([]); // all equal: no winner to point at
  });

  it('ignores columns with no value, and needs two real ones to compare', () => {
    expect(bestColumns([null, 7, 2], 'lower')).toEqual([2]);
    expect(bestColumns([null, 7], 'lower')).toEqual([]);
  });
});
