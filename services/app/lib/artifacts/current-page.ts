/**
 * THE CURRENT PAGE: what every read of an HTML page serves (its raw document and the frame's own re-fetch, the app page,
 * the API GETs, agents' region reads, the title): the saved source with each region's unsaved live text composed in
 * by the same pure compaction a save runs (./regions composeLiveRegions), and a doc's name following its heading as a
 * save would name it (./doc-title). Nothing is committed: versions are checkpoints in history, the live state is the
 * document. Whoever may read the page reads its current page; access is the caller's, decided before this is asked.
 *
 *  - `live` is the page's live revision (./regions liveRevisionOf): (version, live) orders every state a reader can be
 *    served, so the frame's version checks (lib/html-runtime/live-morph) and the stream's pings hold for live text.
 *  - `unsavedIds`: the ids the composition gave blocks typed since the last save. They are provisional (the next save
 *    may give them to other blocks), so they are never offered as comment anchors (lib/html-runtime assembly).
 *  - Composing is Yjs to HTML for the dirty regions only, at most FOLD_EVERY logged updates per region past its folded
 *    state (lib/region-sessions), and cached per page by its version, edit, title and each dirty region's sequence: readers
 *    following typing share one composition per live revision.
 */
import { getDb, type Queryable } from '../platform';
import type { ArtifactRow } from '@/lib/artifact-access';
import { composeLiveRegions, liveRevisionOf, type LiveRevision } from './regions';
import { docTitleAfterSave } from './doc-title';

export type PageRow = Pick<ArtifactRow, 'id' | 'format' | 'version' | 'edit_id' | 'source' | 'title' | 'meta'>;

export interface CurrentPage<R extends PageRow> {
  /** The row as it reads now: its source and title with the live text composed in (the row itself when nothing is unsaved). */
  row: R;
  live: number;
  /** True when some region's unsaved text is composed in. */
  composed: boolean;
  unsavedIds: ReadonlySet<string>;
}

interface Composed { source: string; title: string | null; unsavedIds: ReadonlySet<string> }
const NONE: ReadonlySet<string> = new Set();

/** Least recently used first; bounded by entries and by the characters held. */
const MAX_ENTRIES = 64;
const MAX_CHARS = 16_000_000;
const cache = new Map<string, Composed>();
let held = 0;
/** A rename (metadata, no new version) changes whether the name follows the heading: the title is in the key. */
const keyOf = (row: PageRow, revision: LiveRevision) => `${row.id}\u0000${row.version}\u0000${row.edit_id}\u0000${row.title ?? ''}\u0000${revision.dirty.map((region) => `${region.regionId}@${region.seq}`).join(',')}`;
function remember(key: string, value: Composed): void {
  const previous = cache.get(key);
  if (previous) { held -= previous.source.length; cache.delete(key); }
  cache.set(key, value);
  held += value.source.length;
  while (cache.size > MAX_ENTRIES || held > MAX_CHARS) {
    const [oldest, entry] = cache.entries().next().value!;
    cache.delete(oldest);
    held -= entry.source.length;
  }
}
function recall(key: string): Composed | undefined {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); }
  return hit;
}

/** The live revision alone (a header read: the render cache's and the validator's key), without composing. */
export async function liveRevision(id: string, q?: Queryable): Promise<number> {
  return (await liveRevisionOf(q ?? await getDb(), id)).live;
}

/** The current page of a row read at its head (never an archived version: those are history, served as stored). */
export async function currentPage<R extends PageRow>(row: R, q?: Queryable): Promise<CurrentPage<R>> {
  if (row.format !== 'html') return { row, live: 0, composed: false, unsavedIds: NONE };
  const db = q ?? await getDb();
  const revision = await liveRevisionOf(db, row.id);
  if (!revision.dirty.length) return { row, live: revision.live, composed: false, unsavedIds: NONE };
  let key = keyOf(row, revision);
  let hit = recall(key), live = revision.live;
  if (!hit) {
    const composition = await composeLiveRegions(db, row);
    if (!composition) return { row, live: revision.live, composed: false, unsavedIds: NONE };
    // Keyed by what was composed: an update landing between the two reads is in it.
    key = keyOf(row, composition.revision);
    live = composition.revision.live;
    const before = new Set(composition.base.allocatedIds);
    const named = docTitleAfterSave(row, composition.html);
    hit = { source: named?.html ?? composition.html, title: named?.title ?? row.title, unsavedIds: new Set(composition.ledger.allocatedIds.filter((id) => !before.has(id))) };
    remember(key, hit);
  }
  return { row: { ...row, source: hit.source, title: hit.title }, live, composed: true, unsavedIds: hit.unsavedIds };
}
