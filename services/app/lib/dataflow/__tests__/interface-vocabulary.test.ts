/**
 * lib/dataflow's vocabulary through its doors: the declaration tags and grammar, the built-ins, scalar typing, the
 * compiled record's questions, reader local tables, mutation requests, query values, reference media and column
 * kinds. Pure: no engine, no database.
 */
import { describe, expect, it } from 'vitest';
import { imageReferenceId, imageRefData, platformValues, rawUrl, readerZone } from '..';

import { BUILTIN_TABLES, builtinInput } from '../builtins';

import { inferColumns } from '../dataset-shape';

const PLATFORM = { userId: 'u1', now: '2026-09-30T10:00:00.000Z', tz: 'UTC' };

describe('built-ins', () => {
  it('names the viewer and the built-in tables', () => {
    expect(Object.keys(BUILTIN_TABLES)).toEqual(['_me', '_members']);
    expect(BUILTIN_TABLES._me.columns).toEqual([{ name: 'id', type: 'user' }]);
  });

  it('builtinInput resolves a row field to the _row spec', () => {
    expect(builtinInput('_row.day')?.name).toBe('_row');
    expect(builtinInput('_me.id')?.name).toBe('_me.id');
    expect(builtinInput('_now')?.name).toBe('_now');
    expect(builtinInput('_row.')).toBeNull();
    expect(builtinInput('nope')).toBeNull();
  });

  it('platformValues and reader zones', () => {
    expect(platformValues(PLATFORM)).toEqual({ '_me.id': 'u1', _now: PLATFORM.now, _tz: 'UTC' });
    expect(platformValues({ userId: null, now: 'n', tz: 't' })['_me.id']).toBeNull();
    expect(readerZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    for (const tz of ['Not/AZone', '', 7, null, 'x'.repeat(65)]) expect(readerZone(tz), String(tz)).toBe('UTC');
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

  it('inferColumns types columns from sample rows', () => {
    const cols = inferColumns([{ a: 1, b: 'x', c: true }, { a: 2.5, b: null, c: false }]);
    expect(cols.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(cols.find((c) => c.name === 'a')?.type).toBe('number');
    expect(inferColumns([])).toEqual([]);
  });
});
