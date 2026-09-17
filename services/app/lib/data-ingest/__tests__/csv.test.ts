/**
 * CSV parsing and type coercion.
 *
 * Coercion is the part that carries real risk. Measured before writing any of
 * this (data-artifacts-v2.md §2): all-string rows make `inferColumns` type every
 * column `string`, so a Vega `"type":"quantitative"` encoding on a CSV-sourced
 * column renders a broken chart unless ingest decides types itself.
 *
 * The rule is per COLUMN, never per cell — a column that is half number and
 * half text is worse than a column of text, because it breaks silently at
 * render time rather than loudly here.
 */
import { describe, it, expect } from 'vitest';
import { parseCsv } from '../csv';
import { coerceRows } from '../coerce';

describe('parseCsv — RFC 4180', () => {
  it('parses the ordinary case', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual({ headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] });
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('name,note\n"Smith, John",hi').rows).toEqual([['Smith, John', 'hi']]);
  });

  it('keeps a NEWLINE inside a quoted field — the case that breaks line-splitting', () => {
    expect(parseCsv('a,b\n"line1\nline2",x').rows).toEqual([['line1\nline2', 'x']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"she said ""hi"""').rows).toEqual([['she said "hi"']]);
  });

  it('handles CRLF as well as LF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] });
  });

  it('strips a UTF-8 BOM, which Excel writes and which would corrupt the first header', () => {
    expect(parseCsv('﻿a,b\n1,2').headers).toEqual(['a', 'b']);
  });

  it('ignores a trailing newline rather than inventing an empty row', () => {
    expect(parseCsv('a\n1\n').rows).toEqual([['1']]);
  });

  it('pads a short row and keeps an over-long one addressable', () => {
    expect(parseCsv('a,b,c\n1\n1,2,3,4').rows).toEqual([['1', '', ''], ['1', '2', '3', '4']]);
  });

  it('disambiguates duplicate headers instead of silently dropping a column', () => {
    expect(parseCsv('a,a\n1,2').headers).toEqual(['a', 'a_2']);
  });

  it('names a blank header rather than producing an unusable empty key', () => {
    expect(parseCsv('a,,c\n1,2,3').headers).toEqual(['a', 'column_2', 'c']);
  });

  it('accepts a header-only file (zero rows is legal, empty content is not)', () => {
    expect(parseCsv('a,b')).toEqual({ headers: ['a', 'b'], rows: [] });
  });

  it('does not lose the last field when a quote is never closed', () => {
    // Truncated downloads and hand-edited files do this. Dropping the field
    // silently would shift every later column by one.
    // The field survives; the row is then padded to header width like any other
    // short row, so later columns stay addressable by index.
    expect(parseCsv('a,b\n"unterminated,x').rows).toEqual([['unterminated,x', '']]);
  });

  it('keeps a CRLF inside a quoted field intact', () => {
    expect(parseCsv('a\n"one\r\ntwo"').rows).toEqual([['one\ntwo']]);
  });

  it('handles a single column and whitespace-only fields', () => {
    expect(parseCsv('only\n1\n2').headers).toEqual(['only']);
    expect(parseCsv('a,b\n  ,x').rows).toEqual([['  ', 'x']]);
  });
});

describe('coerceRows — types decided per column', () => {
  const one = (header: string, ...values: string[]) =>
    coerceRows([header], values.map((v) => [v])).map((r) => r[header]);

  it('turns a wholly numeric column into numbers', () => {
    expect(one('n', '120', '150', '-3.5', '1e5')).toEqual([120, 150, -3.5, 1e5]);
  });

  it('KEEPS leading zeros as text — zip codes must not become numbers', () => {
    expect(one('zip', '01234', '09876')).toEqual(['01234', '09876']);
  });

  it('keeps phone-like values as text', () => {
    expect(one('phone', '+15550100', '+15550111')).toEqual(['+15550100', '+15550111']);
  });

  it('leaves a MIXED column entirely as text — one bad cell demotes the column', () => {
    expect(one('mixed', '120', 'abc')).toEqual(['120', 'abc']);
  });

  it('reads blanks as null, so a missing cell is missing rather than empty text', () => {
    expect(one('v', '1', '')).toEqual([1, null]);
    expect(one('allblank', '', '')).toEqual([null, null]);
  });

  it('coerces booleans, case-insensitively', () => {
    expect(one('b', 'true', 'FALSE')).toEqual([true, false]);
  });

  it('coerces ISO dates but refuses ambiguous ones', () => {
    expect(one('d', '2026-01-02', '2026-02-03')).toEqual(['2026-01-02', '2026-02-03']);
    // 03/04/2026 is March 4th or April 3rd depending on the reader. Guessing
    // would silently corrupt data, so it stays text.
    expect(one('d2', '03/04/2026', '04/05/2026')).toEqual(['03/04/2026', '04/05/2026']);
  });

  it('trims surrounding whitespace when deciding a number', () => {
    expect(one('n', ' 42 ', '43')).toEqual([42, 43]);
  });

  it('builds objects keyed by header, in header order', () => {
    const rows = coerceRows(['a', 'b'], [['1', 'x']]);
    expect(rows).toEqual([{ a: 1, b: 'x' }]);
    expect(Object.keys(rows[0])).toEqual(['a', 'b']);
  });
});

describe('coerceRows — a DECLARED type wins over the sniffer', () => {
  /**
   * The sniffer is a guess, and the uploader often knows better: an ID column
   * of `120, 150` is text, not a quantity. Before this, declaring it collided
   * with coercion — the value was converted to a number and then rejected by
   * publishDataset's own validation ("120 is not a string"), so the documented
   * escape hatch actually made the request FAIL.
   */
  const col = (name: string, type: string) => [{ name, type }];

  it('keeps a numeric-looking column as text when declared string', () => {
    const rows = coerceRows(['code'], [['120'], ['150']], col('code', 'string'));
    expect(rows.map((r) => r.code)).toEqual(['120', '150']);
  });

  it('forces a number when declared, even where the sniffer would not', () => {
    // Leading zeros normally stay text; an explicit declaration overrides that.
    const rows = coerceRows(['zip'], [['01234'], ['09876']], col('zip', 'number'));
    expect(rows.map((r) => r.zip)).toEqual([1234, 9876]);
  });

  it('nulls a value that cannot be the declared type instead of throwing', () => {
    const rows = coerceRows(['n'], [['12'], ['abc']], col('n', 'number'));
    expect(rows.map((r) => r.n)).toEqual([12, null]);
  });

  it('only overrides the columns actually declared', () => {
    const rows = coerceRows(['a', 'b'], [['1', '2']], col('a', 'string'));
    expect(rows[0]).toEqual({ a: '1', b: 2 }); // b still sniffed
  });

  it('honours a declared date, and a declared type on a column of blanks', () => {
    expect(coerceRows(['d'], [['2026-01-02']], col('d', 'date'))[0].d).toBe('2026-01-02');
    expect(coerceRows(['x'], [['']], col('x', 'number'))[0].x).toBeNull();
  });

  it('ignores an unknown declared type rather than corrupting the column', () => {
    // A typo like "int" must fall back to sniffing, not silently null everything.
    expect(coerceRows(['n'], [['12']], col('n', 'int'))[0].n).toBe(12);
  });

  it('ignores a declaration naming a column that is not there', () => {
    const rows = coerceRows(['a'], [['1']], col('nope', 'string'));
    expect(rows[0]).toEqual({ a: 1 });
  });
});
