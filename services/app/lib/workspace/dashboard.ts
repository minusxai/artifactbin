/**
 * The signed-in account workspace shared by Home and an owned folder page.
 *
 * Location changes only the shelf. Dashboard totals, engagement and
 * shortcuts describe the account as a whole, so they are computed once here
 * and travel unchanged to either page.
 */
import {getGroupRole} from '@/lib/groups';
import { forkCountByUser, likeSummaryByUser, VIEW_SERIES_DAYS, viewSeriesByUser } from './analytics';
import { count } from '@/lib/accounts';
import { LIVE_ARTIFACT_SQL } from '@/lib/artifacts/table';
import { getDb } from '@/lib/platform/db';
import type { SharedArtifactSummary } from './';
import { workspaceCountsFor, workspaceDocumentsFor } from './inventory';


// Workspace projections deliberately exclude source metadata and engagement.
// Discovery keeps the same ownership/share/trash gates as the general listings.
export type WorkspaceSharedItem = Pick<SharedArtifactSummary, 'id' | 'title' | 'description' | 'format' | 'version' | 'visibility' | 'updated_at' | 'owner_username' | 'role'>;

export async function accountWorkspaceCoreFor(userId: string, email?: string | null, groupId?:string) {
  if(groupId && !(await getGroupRole(userId,groupId)))return null;
  const db = await getDb();
  const [artifacts, shared] = await Promise.all([
    workspaceDocumentsFor(userId,groupId),
    email && !groupId ? db.query<WorkspaceSharedItem>(`SELECT a.id, a.title, a.description, a.format, a.version, a.visibility, a.updated_at, u.username AS owner_username, s.role
      FROM artifacts a JOIN artifact_shares s ON s.artifact_id = a.id LEFT JOIN users u ON u.id = a.user_id
      WHERE s.email = $1 AND a.user_id IS DISTINCT FROM $2::text AND a.${LIVE_ARTIFACT_SQL}
      ORDER BY a.updated_at DESC LIMIT 200`, [email.toLowerCase().trim(), userId]) : { rows: [] },
  ]);
  return {
    artifacts: artifacts.map((artifact) => ({
      ...artifact, url: `/a/${artifact.id}`,
    })), shared: shared.rows,
  };
}

/**
 * No shelf query here: the account-wide counts already identify their documents. Everything sent is NUMBERS.
 * Home draws no per-document picture from them (its one chart is `viewsOverTime`, drawn in the browser), so no
 * sparkline travels: rendering one Vega SVG per document was the whole CPU cost and ~90% of the bytes.
 */
export async function accountWorkspaceInsightsFor(userId: string) {
  const [series, likes, followers, forks, { stats, views }] = await Promise.all([
    viewSeriesByUser(userId, VIEW_SERIES_DAYS, 'html'), likeSummaryByUser(userId),
    count('follow', userId), forkCountByUser(userId), workspaceCountsFor(userId),
  ]);

  const viewsOverTime = new Array<number>(VIEW_SERIES_DAYS).fill(0);
  for (const buckets of series.values()) {
    buckets.forEach((views, day) => { viewsOverTime[day] += views; });
  }

  return {
    stats,
    views,
    viewsOverTime,
    likes: likes.total,
    likesOverTime: likes.series,
    followers,
    forks,
  };
}

export async function accountWorkspaceFor(userId: string, email?: string | null) {
  const [core, insights] = await Promise.all([
    accountWorkspaceCoreFor(userId, email), accountWorkspaceInsightsFor(userId),
  ]);
  return { ...core, ...insights, artifacts: core!.artifacts.map((row) => ({ ...row, views: insights.views[row.id] ?? 0 })) };
}

export type AccountWorkspaceCore = NonNullable<Awaited<ReturnType<typeof accountWorkspaceCoreFor>>>;
export type AccountWorkspaceInsights = Awaited<ReturnType<typeof accountWorkspaceInsightsFor>>;

export type AccountWorkspace = Awaited<ReturnType<typeof accountWorkspaceFor>>;
