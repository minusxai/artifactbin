import { describe, expect, it } from 'vitest';
import { aggregateNumber, NUMBER_AGGS } from '../number-aggregation';

const rows = [{ v: 3 }, { v: 'x' }, { v: 1 }, { v: 10 }, { v: 4 }];

describe('aggregateNumber', () => {
  it('computes every aggregation over the numeric cells of a column', () => {
    expect(aggregateNumber(rows, 'v', 'first')).toBe(3);
    expect(aggregateNumber(rows, 'v', 'last')).toBe(4);
    expect(aggregateNumber(rows, 'v', 'sum')).toBe(18);
    expect(aggregateNumber(rows, 'v', 'avg')).toBe(4.5);
    expect(aggregateNumber(rows, 'v', 'median')).toBe(3.5);
    expect(aggregateNumber(rows, 'v', 'min')).toBe(1);
    expect(aggregateNumber(rows, 'v', 'max')).toBe(10);
    expect(aggregateNumber(rows, 'v', 'count')).toBe(5);
  });
  it('takes the middle value of an odd count and nothing of an empty column', () => {
    expect(aggregateNumber([{ v: 5 }, { v: 1 }, { v: 9 }], 'v', 'median')).toBe(5);
    for (const agg of NUMBER_AGGS.filter((a) => a !== 'count' && a !== 'sum')) expect(aggregateNumber([], 'v', agg)).toBeNaN();
  });
});
