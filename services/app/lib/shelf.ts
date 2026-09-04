/**
 * HOW A FLAT LIST OF ARTIFACTS BECOMES A DRIVE-LIKE SHELF.
 *
 * Documents stay in one recency-ranked collection so the renderer can switch
 * between a uniform icon grid and a dense list without changing the data.
 * Supporting assets remain separate: they are managed on the homepage and
 * never appear on a public profile.
 */

// TYPE-ONLY, so the module stays runtime-pure: the visibility vocabulary is
// declared once in lib/artifacts and re-listing it here would be the second
// spelling this codebase keeps refusing.
import type { Visibility } from '@/lib/artifacts';

/**
 * THE FOLDER A ROW SITS IN, from either half of the placement wire.
 *
 * `ancestor_ids` is the stored truth (root→parent) and `parent_id` is the
 * DERIVED half a client writes back — and the two page endpoints send
 * different subsets of them, because each sends what its own client needed.
 * Reading only the derived one made every folder on the dashboard look empty,
 * which is a wrong count and an offered delete the door would refuse.
 */
export const parentOfRow = (row: { parent_id?: string | null; ancestor_ids?: string[] }): string | null =>
  row.parent_id ?? (row.ancestor_ids?.length ? row.ancestor_ids[row.ancestor_ids.length - 1] : null);

/** The only two fields the policy reads. Callers pass richer rows. */
export interface ShelfItem {
  format: string;
  updated_at: string;
}

/**
 * ONE ROW AS EVERY SHELF DRAWS IT — the superset, with every field past the
 * policy's two optional by design.
 *
 * It lives HERE, beside the policy, rather than in the component that renders
 * it, because it is what a page ANSWERS and not how the answer looks: the
 * dashboard, the profile and now a folder's page each build these rows on the
 * server, and a server module may not import React. `components/Shelf.tsx`
 * re-exports it, so nothing that already named it had to move.
 */
export interface ShelfRow extends ShelfItem {
  id: string;
  url: string;
  title: string | null;
  description?: string | null;
  version: number;
  visibility?: Visibility;
  /** The id of the folder artifact this row sits in; absent/null = the root. */
  parent_id?: string | null;
  /** The trail root->parent, so a folder's own subtree can be greyed in the picker. */
  ancestor_ids?: string[];
  views?: number;
  /** Server-rendered spline (inline SVG). Absent = draw none. */
  sparkline?: string;
}

export interface Shelf<T> {
  /** Markup documents, newest first. */
  documents: T[];
  /** Non-markup rows, newest first. */
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

/** A document is markup; a folder is a place; everything else is material a document is built from. */
const isDocument = (row: ShelfItem): boolean => row.format === 'markup';
const isFolder = (row: ShelfItem): boolean => row.format === 'folder';

export function buildShelf<T extends ShelfItem>(rows: readonly T[]): Shelf<T> {
  const documents: T[] = [];
  const assets: T[] = [];
  const folders: T[] = [];
  for (const row of rows) (isFolder(row) ? folders : isDocument(row) ? documents : assets).push(row);

  documents.sort(byRecency);
  assets.sort(byRecency);
  folders.sort(byRecency);

  return { documents, assets, folders, total: documents.length };
}

/** ISO-8601 UTC strings sort chronologically without parsing. The sort is stable. */
const byRecency = (a: ShelfItem, b: ShelfItem): number =>
  a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;
