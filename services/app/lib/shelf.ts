/**
 * HOW A FLAT LIST OF ARTIFACTS BECOMES A SHELF.
 *
 * The dashboard, the owner's profile root and a stranger's profile are three
 * different QUERIES with one presentation. This module is that presentation's
 * policy half — pure, so it can be reasoned about without a database, a
 * browser, or React — and `components/Shelf.tsx` renders what it returns.
 *
 * Two decisions live here, both learned from a real account (20 artifacts:
 * 11 markup, 9 dataset, 0 folders):
 *
 * 1. ASSETS ARE NOT PEERS. Datasets, images and viz recipes are the material
 *    documents are built from (bound as `ref:<id>`), and on that account they
 *    were 45% of the shelf — every one of them displacing a real deliverable
 *    from view. They come out of the main flow entirely. This is the same
 *    judgement `listPublicArtifactsByUser` already makes for the public
 *    profile ("a profile that lists them reads as a junk drawer"); the only
 *    new part is that the OWNER deserves it too, where they still need the
 *    assets reachable rather than hidden.
 *
 * 2. THE SHELF DEGRADES BY RANK, so it never renders a hundred of anything.
 *    A uniform grid has to be tuned for a count it will not always have; a
 *    tiered one spends attention in proportion to how likely a row is to be
 *    the one you came back for. Most recent gets full width, the next few get
 *    thumbnails, the rest get dense rows — and only that last tier ever needs
 *    a pager.
 *
 * Generic over the row type ON PURPOSE: the three callers pass different
 * SUPERSETS (the dashboard has views and splines, a stranger's profile has
 * neither), and this module must never learn which. It reads exactly two
 * fields — `format` to partition, `updated_at` to rank — and passes whole
 * rows through untouched.
 */

/** The only two fields the policy reads. Callers pass richer rows. */
export interface ShelfItem {
  format: string;
  updated_at: string;
}

export interface ShelfOptions {
  /** Rows in the thumbnail tier, after the hero. Default 3. */
  cards?: number;
  /**
   * Collapse the tiers into one ranked list. Tiers describe BROWSING; a
   * search result is already ordered by the user's intent, and promoting its
   * first hit to full width says "this is where you left off" when it is not.
   */
  flat?: boolean;
}

export interface Shelf<T> {
  /** Most recent document — full width. Null when there are no documents. */
  hero: T | null;
  /** The next `cards` documents — thumbnails. */
  cards: T[];
  /** Everything after that — dense rows, and the only tier that pages. */
  list: T[];
  /** Non-markup rows (dataset, image, viz), pulled out of the flow entirely. */
  assets: T[];
  /**
   * Folders — a THIRD partition, never in `assets` and never in `documents`.
   * A folder is neither: it is not material a document is built from, and it is
   * not a deliverable, it is where the deliverables are. `total` still counts
   * documents, so making a folder never changes what the shelf says you have.
   */
  folders: T[];
  /** Document count — `assets` and `folders` excluded, so it counts deliverables. */
  total: number;
}

const DEFAULT_CARDS = 3;

/** A document is markup; a folder is a place; everything else is material a document is built from. */
const isDocument = (row: ShelfItem): boolean => row.format === 'markup';
const isFolder = (row: ShelfItem): boolean => row.format === 'folder';

export function buildShelf<T extends ShelfItem>(
  rows: readonly T[],
  { cards = DEFAULT_CARDS, flat = false }: ShelfOptions = {},
): Shelf<T> {
  // Partition into fresh arrays, which is also what keeps the caller's array
  // unsorted underneath us — the ranking below is in-place on ours.
  const documents: T[] = [];
  const assets: T[] = [];
  const folders: T[] = [];
  for (const row of rows) (isFolder(row) ? folders : isDocument(row) ? documents : assets).push(row);

  documents.sort(byRecency);
  assets.sort(byRecency);
  folders.sort(byRecency);

  // Flat: one ranked list. A search result is already ordered by the user's
  // intent, and promoting its first hit to full width would say "this is where
  // you left off" about a row they have never seen.
  if (flat) return { hero: null, cards: [], list: documents, assets, folders, total: documents.length };

  const [hero = null, ...rest] = documents;
  return { hero, cards: rest.slice(0, cards), list: rest.slice(cards), assets, folders, total: documents.length };
}

/**
 * Newest first. ISO-8601 UTC strings order lexicographically exactly as they
 * order chronologically, so this needs no Date parsing — and a plain compare
 * rather than localeCompare, which is locale-sensitive. Array.prototype.sort
 * is stable, so rows sharing a timestamp keep the caller's order.
 */
const byRecency = (a: ShelfItem, b: ShelfItem): number =>
  a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;
