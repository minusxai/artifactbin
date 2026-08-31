/**
 * The `<Number>` inspector's lens — read the embed's binding out of the source,
 * write a partial edit back. Mirrors story-viz.test.ts: a prop edit through
 * updateJsxElementAtPath, guarded so a stale path can never corrupt a body.
 *
 * The edit is PARTIAL by design (undefined = leave untouched, null = remove):
 * an "unchanged" table field must leave the binding alone.
 */
import { describe, it, expect } from 'vitest';
import { readNumberEmbed, updateNumberEmbedInJsx, NUMBER_AGGS } from '@/lib/data/story/story-number';

const SRC =
  '<div><p>Revenue <Number data="$sales" col="v" agg="sum" prefix="$" /> up</p>' +
  '<Number col="v" /></div>';
// Paths: div=0 → [p=0.0 → [text, Number=0.0.1], Number=0.1]
const BOUND_PATH = '0.0.1';
const UNBOUND_PATH = '0.1';

describe('readNumberEmbed', () => {
  it('reads a bound Number: table, column, agg and decorations', () => {
    expect(readNumberEmbed(SRC, BOUND_PATH)).toEqual({
      table: 'sales', col: 'v', agg: 'sum',
      prefix: '$', suffix: null, format: null,
    });
  });

  it('reads an unbound Number with a null table', () => {
    expect(readNumberEmbed(SRC, UNBOUND_PATH)).toEqual({
      table: null, col: 'v', agg: null,
      prefix: null, suffix: null, format: null,
    });
  });

  it('returns null for a non-Number node, a stale path and an unparseable source', () => {
    expect(readNumberEmbed(SRC, '0.0')).toBeNull();
    expect(readNumberEmbed(SRC, '9.9')).toBeNull();
    expect(readNumberEmbed('<p>unterminated', BOUND_PATH)).toBeNull();
  });
});

describe('updateNumberEmbedInJsx', () => {
  it('sets the fields it is given and leaves the rest untouched', () => {
    const next = updateNumberEmbedInJsx(SRC, BOUND_PATH, { col: 'total', agg: 'avg' });
    expect(next).toContain('<Number data="$sales" col="total" agg="avg" prefix="$" />');
  });

  it('binds a table by name, adding the $ prefix', () => {
    const next = updateNumberEmbedInJsx(SRC, BOUND_PATH, { table: 'top' });
    expect(next).toContain('data="$top"');
    expect(updateNumberEmbedInJsx(SRC, BOUND_PATH, { table: '$top' })).toContain('data="$top"');
  });

  it('a table pick binds an unbound Number', () => {
    const next = updateNumberEmbedInJsx(SRC, UNBOUND_PATH, { table: 'top' });
    expect(next.match(/data="\$top"/g)).toHaveLength(1);
  });

  it('an edit WITHOUT a table field leaves the binding alone', () => {
    const next = updateNumberEmbedInJsx(SRC, BOUND_PATH, { col: 'total' });
    expect(next).toContain('data="$sales"');
    expect(next).toContain('col="total"');
  });

  it('null removes an attribute; a blank table name is a slip and is ignored', () => {
    const next = updateNumberEmbedInJsx(SRC, BOUND_PATH, { prefix: null, agg: null });
    expect(next).not.toContain('prefix=');
    expect(next).not.toContain('agg=');
    expect(updateNumberEmbedInJsx(SRC, BOUND_PATH, { table: '  ' })).toBe(SRC);
    expect(updateNumberEmbedInJsx(SRC, BOUND_PATH, { table: null })).not.toContain('data=');
  });

  it('refuses a stale path, a non-Number target and an unparseable source', () => {
    expect(updateNumberEmbedInJsx(SRC, '9.9', { col: 'x' })).toBe(SRC);
    expect(updateNumberEmbedInJsx(SRC, '0.0', { col: 'x' })).toBe(SRC);
    expect(updateNumberEmbedInJsx('<p>unterminated', BOUND_PATH, { col: 'x' })).toBe('<p>unterminated');
  });
});

describe('NUMBER_AGGS', () => {
  it('matches the aggregations InlineNumber actually computes', () => {
    expect(NUMBER_AGGS).toEqual(['first', 'sum', 'avg', 'min', 'max', 'count']);
  });
});
