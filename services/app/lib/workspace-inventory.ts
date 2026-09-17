/** Account inventory queries: shelf limits never determine account totals or asset reachability. */
import { getDb } from '@/lib/db';
import { LIVE_ARTIFACT_SQL, type ArtifactSummary } from '@/lib/artifacts';

export interface WorkspaceStats { artifacts: number; assets: number; views: number }
export interface AssetSelection { page: number; query: string; formats: string[]; visibilities: string[] }
const ASSETS_PAGE_SIZE = 50;
type InventoryRow = Pick<ArtifactSummary, 'id' | 'title' | 'format' | 'version' | 'visibility' | 'ancestor_ids' | 'updated_at'>;
const COLS = 'id, title, format, version, visibility, ancestor_ids, updated_at';
const OWNED = `user_id = $1 AND ${LIVE_ARTIFACT_SQL}`;
const ASSETS = `${OWNED} AND format NOT IN ('markup', 'folder')`;
const project = (row: InventoryRow) => ({ ...row, url: `/a/${row.id}` });

export async function workspaceDocumentsFor(userId: string) {
  const db = await getDb();
  const result = await db.query<InventoryRow>(`SELECT ${COLS}
    FROM artifacts WHERE ${OWNED} AND format IN ('markup', 'folder')
    ORDER BY updated_at DESC, id DESC LIMIT 1000`, [userId]);
  return result.rows;
}

/** Preserve the shelf's per-document, all-time view semantics, without its row limit. */
export async function workspaceStatsFor(userId: string): Promise<WorkspaceStats> {
  const db = await getDb();
  const result = await db.query<WorkspaceStats>(`SELECT
    COUNT(*) FILTER (WHERE format = 'markup')::int AS artifacts,
    COUNT(*) FILTER (WHERE format NOT IN ('markup', 'folder'))::int AS assets,
    (SELECT COUNT(DISTINCT (e.artifact_id, COALESCE(e.visitor, e.seq::text)))::int
     FROM analytics_events e JOIN artifacts a ON a.id = e.artifact_id
     WHERE a.user_id = $1 AND a.${LIVE_ARTIFACT_SQL} AND a.format = 'markup' AND e.event = 'view') AS views
    FROM artifacts WHERE ${OWNED}`, [userId]);
  return result.rows[0];
}

/** Search/filter before pagination; stable tie breaking also covers bulk uploads. */
export async function workspaceAssetsFor(userId: string, selection: AssetSelection) {
  const db = await getDb();
  const where = `${ASSETS}
    AND ($2 = '' OR strpos(lower(COALESCE(title, '') || ' ' || format), $2) > 0)
    AND (cardinality($3::text[]) = 0 OR format = ANY($3::text[]))
    AND (cardinality($4::text[]) = 0 OR visibility = ANY($4::text[]))`;
  const values = [userId, selection.query.trim().toLowerCase(), selection.formats, selection.visibilities];
  // Read a consistent snapshot for counts and rows, including on PostgreSQL.
  return db.transaction(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const count = await tx.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM artifacts WHERE ${where}`, values);
    const total = count.rows[0].total;
    const page = Math.min(selection.page, Math.max(0, Math.ceil(total / ASSETS_PAGE_SIZE) - 1));
    const assets = await tx.query<InventoryRow>(`SELECT ${COLS} FROM artifacts WHERE ${where}
      ORDER BY updated_at DESC, id DESC LIMIT $5 OFFSET $6`, [...values, ASSETS_PAGE_SIZE, page * ASSETS_PAGE_SIZE]);
    const folders = await tx.query<InventoryRow>(`SELECT ${COLS} FROM artifacts WHERE ${OWNED} AND format = 'folder' ORDER BY title, id`, [userId]);
    const facets = await tx.query<{ format: string; visibility: string }>(`SELECT DISTINCT format, visibility FROM artifacts WHERE ${ASSETS}`, [userId]);
    return {
      assets: assets.rows.map(project), folders: folders.rows.map(project), total, page, perPage: ASSETS_PAGE_SIZE,
      formats: [...new Set(facets.rows.map(row => row.format))],
      visibilities: [...new Set(facets.rows.map(row => row.visibility))],
    };
  });
}
export type WorkspaceAssets = Awaited<ReturnType<typeof workspaceAssetsFor>>;
