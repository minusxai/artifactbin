/**
 * The shelf policy: assets out of the flow, documents ranked into tiers.
 *
 * These are the rules the three listing pages share. They are tested against
 * `buildShelf` itself rather than through a component, because the policy is
 * the part that must not drift: a component can be restyled freely, but a
 * shelf that promotes a dataset to full width, or that ranks by insertion
 * order instead of recency, is wrong on every page at once.
 */
import { describe, expect, it } from 'vitest';
import { buildShelf, type ShelfItem } from '@/lib/shelf';

/** `n` documents, NEWEST FIRST by construction — doc0 is the most recent. */
const docs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `doc${i}`,
    format: 'markup',
    // Descending: i=0 is the latest day.
    updated_at: `2026-08-${String(28 - i).padStart(2, '0')}T00:00:00.000Z`,
  }));

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('buildShelf — assets are never peers', () => {
  it('pulls every non-markup row out of the flow', () => {
    const shelf = buildShelf([
      { id: 'd1', format: 'dataset', updated_at: '2026-08-28T00:00:00.000Z' },
      { id: 'm1', format: 'markup', updated_at: '2026-08-27T00:00:00.000Z' },
      { id: 'i1', format: 'image', updated_at: '2026-08-26T00:00:00.000Z' },
      { id: 'v1', format: 'viz', updated_at: '2026-08-25T00:00:00.000Z' },
    ]);
    // The dataset is the most recent row of all and still must not be hero.
    expect(shelf.hero?.id).toBe('m1');
    expect(ids(shelf.assets)).toEqual(['d1', 'i1', 'v1']);
    expect(ids([...shelf.cards, ...shelf.list])).toEqual([]);
  });

  it('counts DOCUMENTS in total, not assets', () => {
    const shelf = buildShelf([
      ...docs(2),
      { id: 'd1', format: 'dataset', updated_at: '2026-08-01T00:00:00.000Z' },
    ]);
    expect(shelf.total).toBe(2);
  });

  it('a shelf of nothing but assets has no hero', () => {
    const shelf = buildShelf([{ id: 'd1', format: 'dataset', updated_at: '2026-08-28T00:00:00.000Z' }]);
    expect(shelf.hero).toBeNull();
    expect(shelf.total).toBe(0);
    expect(ids(shelf.assets)).toEqual(['d1']);
  });
});

describe('buildShelf — tiers', () => {
  it('is empty all the way down for no rows', () => {
    const shelf = buildShelf([]);
    expect(shelf).toEqual({ hero: null, cards: [], list: [], assets: [], total: 0 });
  });

  it('one document is a hero and nothing else', () => {
    const shelf = buildShelf(docs(1));
    expect(shelf.hero?.id).toBe('doc0');
    expect(shelf.cards).toEqual([]);
    expect(shelf.list).toEqual([]);
  });

  it('fills the card tier before the list tier', () => {
    const shelf = buildShelf(docs(4));
    expect(shelf.hero?.id).toBe('doc0');
    expect(ids(shelf.cards)).toEqual(['doc1', 'doc2', 'doc3']);
    expect(shelf.list).toEqual([]);
  });

  it('overflows into the list tier once the cards are full', () => {
    const shelf = buildShelf(docs(7));
    expect(shelf.hero?.id).toBe('doc0');
    expect(ids(shelf.cards)).toEqual(['doc1', 'doc2', 'doc3']);
    expect(ids(shelf.list)).toEqual(['doc4', 'doc5', 'doc6']);
  });

  it('honours a custom card count, including zero', () => {
    expect(ids(buildShelf(docs(5), { cards: 1 }).cards)).toEqual(['doc1']);
    expect(ids(buildShelf(docs(5), { cards: 1 }).list)).toEqual(['doc2', 'doc3', 'doc4']);
    const none = buildShelf(docs(3), { cards: 0 });
    expect(none.cards).toEqual([]);
    expect(ids(none.list)).toEqual(['doc1', 'doc2']);
  });
});

describe('buildShelf — ranking is the module’s job, not the caller’s', () => {
  it('ranks by recency however the rows arrive', () => {
    const shuffled = [docs(5)[3], docs(5)[0], docs(5)[4], docs(5)[1], docs(5)[2]];
    const shelf = buildShelf(shuffled);
    expect(shelf.hero?.id).toBe('doc0');
    expect(ids(shelf.cards)).toEqual(['doc1', 'doc2', 'doc3']);
    expect(ids(shelf.list)).toEqual(['doc4']);
  });

  it('keeps input order among rows sharing a timestamp (stable)', () => {
    const same = ['a', 'b', 'c'].map((id) => ({ id, format: 'markup', updated_at: '2026-08-28T00:00:00.000Z' }));
    const shelf = buildShelf(same, { cards: 0 });
    expect(shelf.hero?.id).toBe('a');
    expect(ids(shelf.list)).toEqual(['b', 'c']);
  });

  it('does not mutate or alias the caller’s array', () => {
    const rows = docs(4);
    const snapshot = ids(rows);
    const shelf = buildShelf(rows);
    expect(ids(rows)).toEqual(snapshot);
    expect(shelf.cards).not.toBe(rows);
  });
});

describe('buildShelf — flat mode is for search results', () => {
  it('collapses the tiers into one ranked list', () => {
    const shelf = buildShelf(docs(6), { flat: true });
    expect(shelf.hero).toBeNull();
    expect(shelf.cards).toEqual([]);
    expect(ids(shelf.list)).toEqual(['doc0', 'doc1', 'doc2', 'doc3', 'doc4', 'doc5']);
    expect(shelf.total).toBe(6);
  });

  it('still keeps assets out of the flow', () => {
    const shelf = buildShelf(
      [...docs(2), { id: 'd1', format: 'dataset', updated_at: '2026-08-28T00:00:00.000Z' }],
      { flat: true },
    );
    expect(ids(shelf.list)).toEqual(['doc0', 'doc1']);
    expect(ids(shelf.assets)).toEqual(['d1']);
  });
});

describe('buildShelf — the row type is the caller’s', () => {
  it('passes richer rows through untouched', () => {
    interface Row extends ShelfItem { id: string; views: number; sparkline: string }
    const row: Row = { id: 'x', format: 'markup', updated_at: '2026-08-28T00:00:00.000Z', views: 9, sparkline: '<svg/>' };
    const shelf = buildShelf<Row>([row]);
    expect(shelf.hero).toBe(row);
    expect(shelf.hero?.views).toBe(9);
  });
});
