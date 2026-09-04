/**
 * FOLDERS — the one module that knows the hierarchy.
 *
 * A folder is an artifact with `format: 'folder'`. Placement is
 * `artifacts.ancestor_ids`, the ids of the ancestors root→parent: `[]` is the
 * root, the last element is the parent, the length is the level. Nothing
 * outside this module does array arithmetic on it.
 *
 * The shape of everything here follows from that one storage decision. The
 * parent is the last element, so moving a folder is a PREFIX SWAP over its
 * subtree in ONE statement; the level is the length, so the depth cap is a
 * comparison and never a walk; and a folder is an ordinary artifact row, so
 * its children are a TABLE the document's own dataflow reads, computed per
 * viewer on the server. Plan: ~/projects/artifactbin-folders.md.
 */
import { getDb } from '@/lib/db';
import { canAnnotate, canEdit, canRead } from '@/lib/share-roles';
// The hierarchy builds its own statements rather than going through the
// row-loading seam, so every one of them names the trash gate: a trashed
// folder is not somewhere to file into, and a trashed child is not listed.
import { effectiveRole, roleWithoutLink, LIVE_ARTIFACT_SQL, type ArtifactRow, type RoleActor } from '@/lib/artifacts';
import type { ArtifactFormat } from '@/lib/story/input';
import { channelFor } from '@/lib/story/live';
import { renderSparklineSvg } from '@/lib/viz/sparkline';
// The TYPED column shape (@artifactbin/contracts), not dataset-usage's loose
// one: these columns are registered into the engine, so their types are the
// engine's vocabulary.
import type { DatasetColumn } from '@/lib/story/dataset-shape';

/**
 * No chain may be longer than this. A row's level IS `ancestor_ids.length`, so
 * a root folder is level 0 and the sixth row down is level 5: the rule is that
 * a resulting row's level stays BELOW this number.
 */
export const MAX_FOLDER_DEPTH = 6;

/** How many days of history the children table's sparkline covers. */
const SPARKLINE_DAYS = 14;

/** The fixed shape of a folder's children table, registered as `ref_<folderId>` in a <Query>. */
export const CHILDREN_COLUMNS: DatasetColumn[] = [
  { name: 'id', type: 'string' }, { name: 'title', type: 'string' }, { name: 'format', type: 'string' },
  { name: 'level', type: 'number' }, { name: 'visibility', type: 'string' }, { name: 'updated_at', type: 'string' },
  { name: 'url', type: 'string' }, { name: 'thumbnail', type: 'string' }, { name: 'views', type: 'number' }, { name: 'sparkline', type: 'string' },
];

/** One refusal for unknown, not-a-folder, not-yours, cycle and too deep — naming them apart is an existence oracle. */
export type ParentRefusal = { error: 'invalid_parent' };

/**
 * The refusal itself, exported because one door answers it without ever
 * reaching `resolveParent`: the replace path refuses a NON-OWNER's placement
 * outright (lib/artifact-wire), and it must say the same word as every other
 * way of not being allowed a parent, or the difference is an oracle.
 */
export const PARENT_REFUSED: ParentRefusal = { error: 'invalid_parent' };

/** Narrow `resolveParent`'s answer: the refusal, or a placement. */
export const isParentRefusal = (r: { ancestor_ids: string[] } | ParentRefusal): r is ParentRefusal => 'error' in r;

/**
 * The stored source a new folder is stamped with, its own id filled in.
 *
 * Two lines that will not change: everything visual lives in `<Files>`, which
 * is runtime code and improves for every folder at once. It is ORDINARY markup
 * — no sentinel, no read-time substitution — so `raw` serves it, the editor
 * edits it, and an agent reading the document back sees exactly what renders.
 */
export function folderScaffold(id: string): string {
  return `<Helmet><Query name="children">{\`select * from ref_${id} order by updated_at desc\`}</Query></Helmet>\n<Files data="$children" variant="icons" />`;
}

/** The parent of a row (last of ancestor_ids) or null at root. */
export function parentOf(row: Pick<ArtifactRow, 'ancestor_ids'>): string | null {
  const trail = row.ancestor_ids ?? [];
  return trail.length ? trail[trail.length - 1] : null;
}

/** The owner-scope predicate, the same rule every artifact write already uses. */
const ownedBy = (owner: { userId: string | null; tokenId: string }) =>
  (owner.userId ? { where: 'user_id = $2', val: owner.userId } : { where: 'token_id = $2', val: owner.tokenId });

/**
 * Resolve a wire `parent_id` for a row about to be created or moved, AFTER the
 * ownership scope has resolved the row: the parent must be a folder the same
 * owner holds, must not be `moved` or inside it, and the deepest resulting row
 * (parent level + 1 + the moved subtree's height) must stay below
 * MAX_FOLDER_DEPTH. Answers the new `ancestor_ids` for the row.
 *
 * ONE refusal for every way this fails, on purpose: the parent must be your
 * own, so "not found" and "not yours" are the same fact about it, and naming
 * them apart would be an existence oracle for every id in the table.
 */
export async function resolveParent(
  owner: { userId: string | null; tokenId: string },
  parentId: string | null,
  moved: { id: string; format: string } | null,
): Promise<{ ancestor_ids: string[] } | ParentRefusal> {
  if (parentId === null) return { ancestor_ids: [] };
  const db = await getDb();
  const scope = ownedBy(owner);
  const r = await db.query<Pick<ArtifactRow, 'id' | 'format' | 'ancestor_ids'>>(
    `SELECT id, format, ancestor_ids FROM artifacts WHERE id = $1 AND ${scope.where} AND ${LIVE_ARTIFACT_SQL}`,
    [parentId, scope.val],
  );
  const parent = r.rows[0];
  if (!parent || parent.format !== 'folder') return PARENT_REFUSED;
  // The CYCLE, as one containment read on a row already in hand: a folder may
  // not move into itself, nor into anything already under it.
  if (moved && (parent.id === moved.id || (parent.ancestor_ids ?? []).includes(moved.id))) return PARENT_REFUSED;

  const level = (parent.ancestor_ids ?? []).length + 1;
  // The moved subtree's HEIGHT below the row itself. A document has none, and
  // neither has anything being created.
  const height = moved && moved.format === 'folder' ? await subtreeHeight(moved.id) : 0;
  if (level + height >= MAX_FOLDER_DEPTH) return PARENT_REFUSED;
  return { ancestor_ids: [...(parent.ancestor_ids ?? []), parent.id] };
}

/**
 * How far below `id` its deepest descendant sits — 0 for a folder with no
 * children. One GIN-indexed `max(cardinality)` over the subtree, read against
 * the folder's OWN level so the answer is relative and survives the move.
 */
async function subtreeHeight(id: string): Promise<number> {
  const db = await getDb();
  const r = await db.query<{ deepest: number | null; own: number | null }>(
    `SELECT (SELECT MAX(cardinality(ancestor_ids))::int FROM artifacts WHERE ancestor_ids @> ARRAY[$1] AND ${LIVE_ARTIFACT_SQL}) AS deepest,
            (SELECT cardinality(ancestor_ids)::int FROM artifacts WHERE id = $1) AS own`,
    [id],
  );
  const row = r.rows[0];
  if (!row || row.deepest === null || row.own === null) return 0;
  return Math.max(0, row.deepest - row.own);
}

/**
 * THE MOVE, as ONE statement over the subtree — the whole reason placement is
 * an array. Every row under the folder keeps the part of its trail BELOW the
 * folder and swaps the prefix above it, so a 571-row move is one atomic
 * UPDATE rather than a walk.
 *
 * SQL slices are 1-based and inclusive, and the folder's own id sits at
 * `oldLen + 1` in a descendant's trail — so `ancestor_ids[oldLen + 2:]` is
 * exactly "everything below the folder". The moved row ITSELF is not in this
 * statement (it does not contain its own id); its caller sets its trail
 * directly.
 */
export function ancestorsForMove(
  moved: { id: string; ancestor_ids: string[] },
  next: readonly string[],
): { sql: string; params: [string, string[], number] } {
  return {
    sql: `UPDATE artifacts
             SET ancestor_ids = $2::text[] || ancestor_ids[$3::int + 2:]
           WHERE ancestor_ids @> ARRAY[$1]`,
    params: [moved.id, [...next, moved.id], (moved.ancestor_ids ?? []).length],
  };
}

/** One child as the table reads it, before the viewer's own columns are filled. */
interface ChildRow {
  id: string;
  title: string | null;
  format: ArtifactFormat;
  level: number;
  visibility: ArtifactRow['visibility'];
  updated_at: string;
  user_id: string | null;
  token_id: string;
  link_role: ArtifactRow['link_role'];
  version: number;
  views: number;
}

/**
 * The children VIRTUAL TABLE for a folder, computed for ONE viewer on the
 * server and never filtered on the client.
 *
 * Three viewer-dependent facts, each decided here:
 *  - WHICH ROWS — decided by the viewer's relationship to the FOLDER, then to
 *    each child, and NOT by "may they read it". `unlisted` means "reads like
 *    public, listed nowhere", and a folder's page is a listing: a stranger who
 *    holds the folder's address may open an unlisted child by ITS address and
 *    must still not be handed it here. So anyone with a ROLE on the folder —
 *    owner, editor or commenter, which is `canAnnotate` and therefore above
 *    what a public link alone grants — reads the whole shelf, and everyone
 *    else gets the `public` children plus any child they are personally named
 *    on (`roleWithoutLink`: ownership or a share, never the link).
 *  - THE THUMBNAIL — `/a/<child>/export?mode=card` for a public or unlisted
 *    DOCUMENT, null otherwise. A request the sandboxed frame makes carries no
 *    session, so a private child's card would 404 even for its owner; and a
 *    folder's own card is a picture of this listing, which is not worth
 *    drawing inside it.
 *  - THE NUMBERS — `views` and `sparkline` only when the viewer may EDIT the
 *    folder (its owner, or someone named editor on it). Everyone else gets
 *    nulls, decided on the server rather than hidden in the markup.
 */
export async function childrenTableFor(
  folder: ArtifactRow,
  viewer: { userId: string | null; email: string | null; tokenId: string | null } | null,
): Promise<{ rows: Record<string, unknown>[]; columns: DatasetColumn[] }> {
  const db = await getDb();
  const actor: RoleActor = { userId: viewer?.userId ?? null, tokenId: viewer?.tokenId ?? null, email: viewer?.email ?? null };
  const folderRole = await effectiveRole(folder, actor);
  const numbers = canEdit(folderRole);
  // A role on the FOLDER is read as a role on its shelf. `canAnnotate` rather
  // than `canRead` is the whole point: a public folder's link grants `viewer`
  // to every stranger, so a `canRead` threshold would make "has a role here"
  // true for anybody holding the address and list the unlisted children to
  // them — which is the one thing `unlisted` promises will not happen.
  const insider = canAnnotate(folderRole);
  const r = await db.query<ChildRow>(
    `SELECT id, title, format, cardinality(ancestor_ids)::int AS level, visibility, updated_at,
            user_id, token_id, link_role, version,
            (SELECT COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int FROM analytics_events e
             WHERE e.artifact_id = artifacts.id AND e.event = 'view') AS views
       FROM artifacts
      WHERE ancestor_ids[cardinality(ancestor_ids)] = $1 AND ${LIVE_ARTIFACT_SQL}
      ORDER BY updated_at DESC
      LIMIT 500`,
    [folder.id],
  );
  const series = numbers && r.rows.length ? await viewSeries(r.rows.map((c) => c.id)) : new Map<string, number[]>();
  /*
   * ONE Vega render per distinct SERIES, not per row. A sparkline costs ~2.3ms
   * to draw, so a folder of 100 documents spent 230ms of a query response
   * drawing charts — and a folder whose documents are new draws the SAME flat
   * line for every one of them. The key is the series itself, so identical
   * histories collapse and different ones still each get their own picture.
   * Measured at 100 children: 230ms → 6ms.
   */
  const drawn = new Map<string, Promise<string>>();
  const sparkline = (id: string): Promise<string> => {
    const s = series.get(id) ?? new Array<number>(SPARKLINE_DAYS).fill(0);
    const key = s.join(',');
    let svg = drawn.get(key);
    if (!svg) drawn.set(key, (svg = renderSparklineSvg(s)));
    return svg;
  };
  const rows: Record<string, unknown>[] = [];
  for (const c of r.rows) {
    /*
     * Three cheap answers before any query: an insider reads everything, a
     * `public` child is listed to everybody, and only what is left — a private
     * or unlisted child, for a viewer with no role on the folder — costs the
     * share lookup that decides whether they were named on it personally. That
     * lookup also STAMPS resolved shares, so asking it per row unconditionally
     * was up to 500 UPDATEs inside one query response; now it is asked only
     * for the rows that cannot be settled without it, and never at all for an
     * anonymous viewer (`roleWithoutLink` returns `none` with no query).
     * Measured at 100 children read by a signed-in stranger: 25ms → 1ms.
     */
    if (!insider && c.visibility !== 'public' && !canRead(await roleWithoutLink(c, actor))) continue;
    const linkable = c.visibility === 'public' || c.visibility === 'unlisted';
    rows.push({
      id: c.id,
      title: c.title,
      format: c.format,
      level: c.level,
      visibility: c.visibility,
      updated_at: c.updated_at,
      url: `/a/${c.id}`,
      thumbnail: linkable && c.format !== 'folder' ? `/a/${c.id}/export?mode=card&v=${c.version}` : null,
      views: numbers ? c.views : null,
      sparkline: numbers ? await sparkline(c.id) : null,
    });
  }
  return { rows, columns: CHILDREN_COLUMNS };
}

/**
 * Daily unique visitors per artifact, zero-filled — the same shape and the same
 * two pins the dashboard's series uses: `COUNT(DISTINCT COALESCE(visitor,
 * seq::text))` is unique PEOPLE per day, and the bucket is cut `AT TIME ZONE
 * 'UTC'` to match the JS zero-fill below (a bare `date_trunc` cuts in the
 * session timezone, and every evening west of UTC lands in the wrong day).
 */
async function viewSeries(ids: string[], days = SPARKLINE_DAYS): Promise<Map<string, number[]>> {
  const db = await getDb();
  const r = await db.query<{ artifact_id: string; day: string; n: number }>(
    `SELECT e.artifact_id, to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
       COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS n
     FROM analytics_events e
     WHERE e.artifact_id = ANY($1::text[]) AND e.event = 'view' AND e.created_at > now() - ($2::int * interval '1 day')
     GROUP BY e.artifact_id, day`,
    [ids, days],
  );
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const series = new Map<string, number[]>();
  for (const row of r.rows) {
    const age = Math.round((today - Date.parse(row.day)) / 86_400_000);
    const idx = days - 1 - age;
    if (idx < 0 || idx >= days) continue;
    const buckets = series.get(row.artifact_id) ?? new Array<number>(days).fill(0);
    buckets[idx] = row.n;
    series.set(row.artifact_id, buckets);
  }
  return series;
}

/** How many rows sit anywhere under this folder — the count the non-empty refusal names. */
export async function subtreeCount(id: string): Promise<number> {
  const db = await getDb();
  const r = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM artifacts WHERE ancestor_ids @> ARRAY[$1] AND ${LIVE_ARTIFACT_SQL}`, [id]);
  return r.rows[0]?.n ?? 0;
}

/** True when no live row names `id` as its parent. */
export async function folderIsEmpty(id: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.query(`SELECT 1 FROM artifacts WHERE ancestor_ids[cardinality(ancestor_ids)] = $1 AND ${LIVE_ARTIFACT_SQL} LIMIT 1`, [id]);
  return r.rows.length === 0;
}

/** Every id under a folder (GIN containment), for a forced delete. */
export async function subtreeIds(id: string): Promise<string[]> {
  const db = await getDb();
  // Deepest first, so a caller deleting row by row never steps over what is
  // below the row it is on.
  const r = await db.query<{ id: string }>(
    `SELECT id FROM artifacts WHERE ancestor_ids @> ARRAY[$1] AND ${LIVE_ARTIFACT_SQL} ORDER BY cardinality(ancestor_ids) DESC`,
    [id],
  );
  return r.rows.map((x) => x.id);
}

/**
 * The one place that names the channel a child write wakes: the parent
 * folder's OWN.
 *
 * A folder's source names its own id as a table (`ref_<self>`), so the folder
 * is a data dependency of ITSELF and the live stream already subscribes it —
 * a child created, moved, renamed or deleted arrives at an open folder as the
 * existing `data` ping, with no route change anywhere.
 *
 * Never fatal: a listing that does not refresh itself is worth much less than
 * a write that fails.
 */
export async function notifyParent(parentId: string | null): Promise<void> {
  if (!parentId) return;
  try {
    const db = await getDb();
    // channelFor lowercases: unquoted LISTEN case-folds, so a mixed-case id
    // would silently wake nobody.
    await db.query('SELECT pg_notify($1, $2)', [channelFor(parentId), 'child']);
  } catch { /* a listing that does not refresh is not a failed write */ }
}
