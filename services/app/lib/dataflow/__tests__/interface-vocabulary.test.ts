/**
 * lib/dataflow's vocabulary through its doors: the declaration tags and grammar, the built-ins, scalar typing, the
 * compiled record's questions, reader local tables, mutation requests, query values, reference media and column
 * kinds. Pure: no engine, no database.
 */
import { describe, expect, it } from 'vitest';
import {
  imageReferenceId, imageRefData,
  EMPTY_COMPILED_DATAFLOW, LocalStateInputError, localTableOverrides, NUMERIC_AGGS,
  parseLocalTables, platformValues, rawUrl, readerZone, rowField, scalarMatches,
  VIEWER, VIEWER_ID, type CompiledDataflow,
} from '..';

import {
  BUILTIN_TABLES, builtinInput, CLOCK_FUNCTIONS, isBuiltinInput, isBuiltinTable, localZone, READ_ONLY_REF_ATTRS,
  reservedDeclarationName,
} from '../builtins';
import { checkedLocalRows } from '../local-tables';
import { columnVizKind, inferColumns } from '../dataset-shape';

const PLATFORM = { userId: 'u1', now: '2026-09-30T10:00:00.000Z', tz: 'UTC' };

describe('built-ins', () => {
  it('names the viewer and the built-in tables', () => {
    expect([VIEWER, VIEWER_ID]).toEqual(['_me', '_me.id']);
    expect(Object.keys(BUILTIN_TABLES)).toEqual(['_me', '_members']);
    expect(BUILTIN_TABLES._me.columns).toEqual([{ name: 'id', type: 'user' }]);
    expect(isBuiltinTable('_me')).toBe(true);
    expect(isBuiltinTable('_members')).toBe(true);
    expect(isBuiltinTable('members')).toBe(false);
    expect(isBuiltinTable('toString')).toBe(false);
    expect(isBuiltinTable('__proto__')).toBe(false);
  });

  it('builtinInput resolves a row field to the _row spec', () => {
    expect(builtinInput('_row.day')?.name).toBe('_row');
    expect(builtinInput('_me.id')?.name).toBe('_me.id');
    expect(builtinInput('_now')?.name).toBe('_now');
    expect(builtinInput('_row.')).toBeNull();
    expect(builtinInput('nope')).toBeNull();
    expect(isBuiltinInput('_tz')).toBe(true);
    expect(isBuiltinInput('_unknown')).toBe(false);
  });

  it('rowField reads the field of _row only', () => {
    expect(rowField('_row.day')).toBe('day');
    expect(rowField('_row.a_b1')).toBe('a_b1');
    expect(rowField('_row')).toBeNull();
    expect(rowField('row.day')).toBeNull();
    expect(rowField('_me.id')).toBeNull();
  });

  it('refuses SQLite clock functions, and keeps the read-only built-in positions tiny', () => {
    expect([...CLOCK_FUNCTIONS].sort()).toEqual(['current_date', 'current_time', 'current_timestamp']);
    expect(Object.keys(READ_ONLY_REF_ATTRS).sort()).toEqual(['User', 'UserHandle', 'UserImage']);
    expect([...READ_ONLY_REF_ATTRS.User!]).toEqual(['userId']);
  });

  it('reservedDeclarationName names why, or null for a free name', () => {
    expect(reservedDeclarationName('_x')).toMatch(/belong to the built-ins/);
    expect(reservedDeclarationName('ref_abc')).toMatch(/<Import>/);
    expect(reservedDeclarationName('a__b')).toMatch(/double underscore/);
    expect(reservedDeclarationName('plain')).toBeNull();
    expect(reservedDeclarationName('ref')).toBeNull();
  });

  it('platformValues and reader zones', () => {
    expect(platformValues(PLATFORM)).toEqual({ '_me.id': 'u1', _now: PLATFORM.now, _tz: 'UTC' });
    expect(platformValues({ userId: null, now: 'n', tz: 't' })['_me.id']).toBeNull();
    expect(readerZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    for (const tz of ['Not/AZone', '', 7, null, 'x'.repeat(65)]) expect(readerZone(tz), String(tz)).toBe('UTC');
    expect(readerZone(localZone())).toBe(localZone());
  });
});

describe('scalar typing', () => {
  it.each([
    [1.5, 'number', true], [Number.NaN, 'number', false], [Infinity, 'number', false], ['1', 'number', false],
    [true, 'boolean', true], [0, 'boolean', false],
    ['2026-01-31', 'date', true], ['2026-1-31', 'date', false], [20260131, 'date', false],
    ['x', 'string', true], ['', 'string', true], ['u', 'user', true], [1, 'user', false],
    [null, 'number', true], [null, 'date', true],
  ] as const)('scalarMatches(%j, %s) is %s', (value, type, expected) => {
    expect(scalarMatches(value, type)).toBe(expected);
  });
});

it('localTableOverrides validates only declared inline tables', () => {
  const flow: CompiledDataflow = { ...EMPTY_COMPILED_DATAFLOW, values: [
    { name: 't', kind: 'table', type: 'table', default: null, columns: [{ name: 'a', type: 'number' }], rows: [{ a: 1 }] },
  ] };
  expect(localTableOverrides(flow, { t: [{ a: 2 }, {}] })).toEqual({ t: { columns: [{ name: 'a', type: 'number' }], rows: [{ a: 2 }, { a: null }] } });
  expect(localTableOverrides(flow)).toEqual({});
  expect(() => localTableOverrides(flow, { missing: [] })).toThrow(LocalStateInputError);
});

describe('reader local tables', () => {
  const columns = [{ name: 'a', type: 'number' as const }, { name: 'b', type: 'string' as const }];

  it('parseLocalTables bounds the wire shape', () => {
    expect(parseLocalTables({ t: [{ a: 1 }] })).toEqual({ t: [{ a: 1 }] });
    expect(parseLocalTables({})).toEqual({});
    for (const bad of [null, [], 'x', { t: 'rows' }, { t: Array(10_001).fill({}) }, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`t${i}`, []]))]) {
      expect(() => parseLocalTables(bad), JSON.stringify(bad).slice(0, 40)).toThrow(LocalStateInputError);
    }
  });

  it('checkedLocalRows types each row by the declared columns and refuses extra fields', () => {
    expect(checkedLocalRows([{ a: 1 }, { b: 'é' }], columns)).toEqual([{ a: 1, b: null }, { a: null, b: 'é' }]);
    expect(checkedLocalRows([], columns)).toEqual([]);
    expect(() => checkedLocalRows([{ c: 1 }], columns)).toThrow('undeclared fields');
    expect(() => checkedLocalRows([{ a: 'one' }], columns)).toThrow('Local field "a" has an invalid type');
    expect(() => checkedLocalRows([[1]], columns)).toThrow(LocalStateInputError);
    expect(() => checkedLocalRows('rows', columns)).toThrow(LocalStateInputError);
  });
});

describe('numeric aggregates', () => {
  it('keeps the numeric aggregate vocabulary', () => {
    expect([...NUMERIC_AGGS].sort()).toEqual(['avg', 'max', 'median', 'min', 'sum']);
    expect(NUMERIC_AGGS.has('count' as never)).toBe(false);
  });
});

describe('reference media', () => {
  it('rawUrl is the immutable bytes address, versioned', () => {
    expect(rawUrl('Abc123', 4)).toBe('/a/Abc123/raw?v=4');
  });

  it('imageRefData projects dimensions, a data: placeholder and a small variant (not for a capture)', () => {
    const row = { id: 'Img001', version: 2, meta: { width: 640, height: 480, placeholder: 'data:image/png;base64,AA', smallWidth: 320, smallObjectKey: 'k' } };
    const data = imageRefData(row);
    expect(data).toMatchObject({ kind: 'image', url: '/a/Img001/raw?v=2', width: 640, height: 480, blur: 'data:image/png;base64,AA', smallWidth: 320 });
    expect(data.smallUrl).toContain('Img001');
    expect(imageRefData(row, true)).not.toHaveProperty('smallUrl');
    expect(imageRefData({ ...row, meta: { placeholder: 'https://x/a.png', width: '640' } })).toEqual({ kind: 'image', url: '/a/Img001/raw?v=2' });
    expect(imageRefData({ ...row, meta: null })).toEqual({ kind: 'image', url: '/a/Img001/raw?v=2' });
  });

  it('imageReferenceId reads only an exact reference', () => {
    expect(imageReferenceId('ref:Abc123')).toBe('Abc123');
    for (const value of ['ref:abc', 'ref:Abc123!', ' ref:Abc123', 'Abc123', 'ref:', null, 3, undefined]) expect(imageReferenceId(value), String(value)).toBeNull();
  });


});

describe('dataset shape', () => {
  it('columnVizKind maps column types to encoding kinds', () => {
    expect(columnVizKind('number')).toBe('quantitative');
    expect(columnVizKind('date')).toBe('temporal');
    expect(columnVizKind('timestamp')).toBe('temporal');
    for (const t of ['string', 'boolean', 'user'] as const) expect(columnVizKind(t)).toBe('nominal');
  });

  it('inferColumns types columns from sample rows', () => {
    const cols = inferColumns([{ a: 1, b: 'x', c: true }, { a: 2.5, b: null, c: false }]);
    expect(cols.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(cols.find((c) => c.name === 'a')?.type).toBe('number');
    expect(inferColumns([])).toEqual([]);
  });
});
