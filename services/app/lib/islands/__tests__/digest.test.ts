/**
 * The browser rows digest (lib/islands/digest) agrees with the one the server stores on a drawn
 * chart (lib/publish/prepared/charts.server rowsDigest), so an island can tell a current drawing from a
 * stale one without loading Vega.
 */
import { describe, expect, it } from 'vitest';
import { rowsDigest } from '../digest';
import { drawingIsCurrent } from '../chart';
import { rowsDigest as serverRowsDigest } from '@/lib/publish/prepared/charts.server';

const rows = [{ region: 'West', n: 41, at: '2026-09-28T00:00:00Z', ok: true, none: null }, { region: 'Ōsaka "quoted" </script>', n: -1.5, at: null, ok: false, none: null }];

describe('rowsDigest', () => {
  it('is the server digest of the same rows: 16 hex characters of sha256(JSON)', async () => {
    const digest = await rowsDigest(rows);
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    expect(digest).toBe(serverRowsDigest(rows));
    expect(await rowsDigest([])).toBe(serverRowsDigest([]));
    expect(await rowsDigest(rows.slice(1))).not.toBe(digest);
  });

  it('tells a current server drawing from a stale one', async () => {
    const drawing = { svg: '<svg></svg>', table: 't', rows: serverRowsDigest(rows) };
    expect(await drawingIsCurrent(drawing, rows)).toBe(true);
    expect(await drawingIsCurrent(drawing, [...rows, { region: 'East', n: 1, at: null, ok: true, none: null }])).toBe(false);
    expect(await drawingIsCurrent(null, rows)).toBe(false);
  });
});
