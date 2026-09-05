/** The shelf policy: documents, folders, and assets stay separate and rank by recency. */
import { describe, expect, it } from 'vitest';
import { buildShelf, groupShelfByRecency, type ShelfItem } from '@/lib/shelf';

const docs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `doc${i}`,
    format: 'markup',
    updated_at: `2026-08-${String(28 - i).padStart(2, '0')}T00:00:00.000Z`,
  }));
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe('buildShelf', () => {
  it('returns uniform document, folder, and asset collections', () => {
    const shelf = buildShelf([
      { id: 'd1', format: 'dataset', updated_at: '2026-08-28T00:00:00.000Z' },
      { id: 'm1', format: 'markup', updated_at: '2026-08-27T00:00:00.000Z' },
      { id: 'f1', format: 'folder', updated_at: '2026-08-26T12:00:00.000Z' },
      { id: 'i1', format: 'image', updated_at: '2026-08-26T00:00:00.000Z' },
    ]);
    expect(ids(shelf.documents)).toEqual(['m1']);
    expect(ids(shelf.folders)).toEqual(['f1']);
    expect(ids(shelf.assets)).toEqual(['d1', 'i1']);
    expect(shelf.total).toBe(1);
  });

  it('is empty for no rows', () => {
    expect(buildShelf([])).toEqual({ documents: [], assets: [], folders: [], total: 0 });
  });

  it('ranks every collection by recency without mutating the caller', () => {
    const rows = [docs(4)[2], docs(4)[0], docs(4)[3], docs(4)[1]];
    const before = ids(rows);
    const shelf = buildShelf(rows);
    expect(ids(shelf.documents)).toEqual(['doc0', 'doc1', 'doc2', 'doc3']);
    expect(ids(rows)).toEqual(before);
    expect(shelf.documents).not.toBe(rows);
  });

  it('keeps input order among rows sharing a timestamp', () => {
    const same = ['a', 'b', 'c'].map((id) => ({ id, format: 'markup', updated_at: '2026-08-28T00:00:00.000Z' }));
    expect(ids(buildShelf(same).documents)).toEqual(['a', 'b', 'c']);
  });

  it('passes richer row types through untouched', () => {
    interface Row extends ShelfItem { id: string; views: number }
    const row: Row = { id: 'x', format: 'markup', updated_at: '2026-08-28T00:00:00.000Z', views: 9 };
    const shelf = buildShelf<Row>([row]);
    expect(shelf.documents[0]).toBe(row);
    expect(shelf.documents[0].views).toBe(9);
  });
});

describe('groupShelfByRecency', () => {
  it('creates Finder-like calendar groups, omits empty bands, and preserves row order', () => {
    const rows = [
      { id: 'today', format: 'markup', updated_at: '2026-09-04T09:00:00' },
      { id: 'yesterday', format: 'markup', updated_at: '2026-09-03T09:00:00' },
      { id: 'week-newer', format: 'markup', updated_at: '2026-09-01T09:00:00' },
      { id: 'week-older', format: 'markup', updated_at: '2026-08-29T09:00:00' },
      { id: 'month', format: 'markup', updated_at: '2026-08-12T09:00:00' },
      { id: 'old', format: 'markup', updated_at: '2026-07-01T09:00:00' },
    ];
    const groups = groupShelfByRecency(rows, new Date('2026-09-04T12:00:00'));
    expect(groups.map(({ label }) => label)).toEqual(['Today', 'Yesterday', 'This Week', 'Last Month', 'Older']);
    expect(groups.map(({ rows: members }) => ids(members))).toEqual([
      ['today'],
      ['yesterday'],
      ['week-newer', 'week-older'],
      ['month'],
      ['old'],
    ]);
  });

  it('does not render empty date groups', () => {
    const groups = groupShelfByRecency(
      [{ id: 'today', format: 'markup', updated_at: '2026-09-04T09:00:00' }],
      new Date('2026-09-04T12:00:00'),
    );
    expect(groups.map(({ label }) => label)).toEqual(['Today']);
  });
});
