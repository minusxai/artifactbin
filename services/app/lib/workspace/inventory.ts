/** Account inventory queries: shelf limits never determine account totals or asset reachability. */
import { getDb } from '@/lib/platform/db';
import { type ArtifactSummary } from '@/lib/artifacts';
import { LIVE_ARTIFACT_SQL } from '@/lib/artifacts/table';
import { viewTotalsFor } from '@/lib/platform';

export interface WorkspaceStats { artifacts: number; assets: number; views: number }
export interface AssetSelection { page: number; query: string; formats: string[]; visibilities: string[] }
const ASSETS_PAGE_SIZE = 50;
type InventoryRow = Pick<ArtifactSummary, 'id' | 'title' | 'format' | 'version' | 'visibility' | 'ancestor_ids' | 'updated_at'>;
const COLS = 'id, title, format, version, visibility, ancestor_ids, updated_at';
const OWNED = `group_id IS NULL AND user_id = $1 AND ${LIVE_ARTIFACT_SQL}`;
const ASSETS = `${OWNED} AND format NOT IN ('html', 'folder')`;
const project = (row: InventoryRow) => ({ ...row, url: `/a/${row.id}` });

export async function workspaceDocumentsFor(userId: string, groupId?:string) {
  const db = await getDb();
  const result = await db.query<InventoryRow>(`SELECT ${COLS}
    FROM artifacts WHERE ${groupId ? 'group_id = $1 AND '+LIVE_ARTIFACT_SQL : OWNED} AND format IN ('html', 'folder')
    ORDER BY updated_at DESC, id DESC LIMIT 1000`, [groupId??userId]);
  return result.rows;
}

/**
 * The account's totals and every document's view count, in one read of the inventory and one aggregate
 * over the view events (view-totals): the shelf's per-document, all-time semantics, without its row limit.
 * `stats.views` is the sum of the HTML pages' counts, so the headline and the per-document map can
 * never disagree. Documents and folders count views wherever they live; the artifact and asset counts are
 * the personal inventory (`OWNED`).
 */
export async function workspaceCountsFor(userId: string): Promise<{ stats: WorkspaceStats; views: Record<string, number> }> {
  const db = await getDb();
  const result = await db.query<{ artifacts: number; assets: number; documents: string[]; folders: string[] }>(`SELECT
    COUNT(*) FILTER (WHERE group_id IS NULL AND format = 'html')::int AS artifacts,
    COUNT(*) FILTER (WHERE group_id IS NULL AND format NOT IN ('html', 'folder'))::int AS assets,
    COALESCE(array_agg(id) FILTER (WHERE format = 'html'), '{}') AS documents,
    COALESCE(array_agg(id) FILTER (WHERE format = 'folder'), '{}') AS folders
    FROM artifacts WHERE user_id = $1 AND ${LIVE_ARTIFACT_SQL}`, [userId]);
  const { artifacts, assets, documents, folders } = result.rows[0];
  const totals = await viewTotalsFor([...documents, ...folders]);
  return {
    stats: { artifacts, assets, views: documents.reduce((sum, id) => sum + (totals.get(id) ?? 0), 0) },
    views: Object.fromEntries(totals),
  };
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
