import { describe, expect, it } from 'vitest';
import { aggregateNumber, cellValue, NUMBER_AGGS } from '../number-aggregation';

/**
 * WHAT A `<Cell>` SHOWS. Before the rename, `<Number col="name">` over a text column showed "—": every aggregate,
 * `first` included, read only the cells `Number()` could parse. A Cell reads ONE value: `first`/`last` take the
 * first/last cell that is a number or text, and text is shown as written. Every other aggregate stays numeric.
 */
describe('cellValue', () => {
  it('shows a text cell as written under first and last', () => {
    const rows = [{ name: 'Ada' }, { name: 'Grace' }];
    expect(cellValue(rows, 'name', 'first')).toEqual({ kind: 'text', value: 'Ada' });
    expect(cellValue(rows, 'name', 'last')).toEqual({ kind: 'text', value: 'Grace' });
    expect(cellValue([{ day: '2025-01-01' }], 'day', 'first')).toEqual({ kind: 'text', value: '2025-01-01' });
  });

  it('pins the old behaviour it replaces: the numeric reading of a text column is nothing', () => {
    expect(aggregateNumber([{ name: 'Ada' }], 'name', 'first')).toBeNaN();
  });

  it('reads a numeric column exactly as the numeric aggregate does, under every aggregate', () => {
    const shapes = [
      [{ v: 3 }, { v: 1 }, { v: 10 }, { v: 4 }],
      [{ v: null }, { v: 3 }],
      [{ v: '42' }, { v: '7.5' }],
      [{ v: undefined }, { v: 2 }, { v: undefined }],
      [{ v: true }, { v: false }],
      [],
    ];
    for (const rows of shapes) {
      for (const agg of NUMBER_AGGS) {
        const expected = aggregateNumber(rows, 'v', agg);
        expect(cellValue(rows, 'v', agg)).toEqual(Number.isFinite(expected) ? { kind: 'number', value: expected } : null);
      }
    }
  });

  it('takes the first or last cell that holds a value, whichever kind it is', () => {
    const mixed = [{ v: undefined }, { v: 'n/a' }, { v: 5 }, { v: 'pending' }];
    expect(cellValue(mixed, 'v', 'first')).toEqual({ kind: 'text', value: 'n/a' });
    expect(cellValue(mixed, 'v', 'last')).toEqual({ kind: 'text', value: 'pending' });
    expect(cellValue([{ v: 5 }, { v: 'n/a' }], 'v', 'first')).toEqual({ kind: 'number', value: 5 });
  });

  it('keeps numeric strings numeric, skips missing cells, and reads a blank cell as 0 as the numeric aggregate always has', () => {
    expect(cellValue([{ v: '1200' }], 'v', 'first')).toEqual({ kind: 'number', value: 1200 });
    expect(cellValue([{ v: undefined }, { v: '  ' }, { v: 'x' }], 'v', 'first')).toEqual({ kind: 'number', value: 0 });
    expect(cellValue([{ v: undefined }], 'v', 'first')).toBeNull();
  });

  it('keeps the other aggregates numeric over a text column', () => {
    const rows = [{ name: 'Ada' }, { name: 'Grace' }];
    expect(cellValue(rows, 'name', 'count')).toEqual({ kind: 'number', value: 2 });
    expect(cellValue(rows, 'name', 'sum')).toEqual({ kind: 'number', value: 0 });
    for (const agg of ['avg', 'median', 'min', 'max'] as const) expect(cellValue(rows, 'name', agg)).toBeNull();
  });
});
