/**
 * The signed-in account workspace shared by Home and an owned folder page.
 *
 * Location changes only the shelf. Dashboard totals, engagement and
 * shortcuts describe the account as a whole, so they are computed once here
 * and travel unchanged to either page.
 */
import {getGroupRole} from '@/lib/groups';
import { forkCountByUser, likeSummaryByUser, VIEW_SERIES_DAYS, viewSeriesByUser } from './analytics';
import { count } from '@/lib/social';
import type { SharedArtifactSummary } from './';
import { workspaceCountsFor, workspaceDocumentsFor, workspaceSharedFor } from './inventory';


// Workspace projections deliberately exclude source metadata and engagement.
// Discovery keeps the same ownership/share/trash gates as the general listings.
export type WorkspaceSharedItem = Pick<SharedArtifactSummary, 'id' | 'title' | 'description' | 'format' | 'version' | 'visibility' | 'updated_at' | 'owner_username' | 'role'>;

export async function accountWorkspaceCoreFor(userId: string, email?: string | null, groupId?:string) {
  if(groupId && !(await getGroupRole(userId,groupId)))return null;
  const [artifacts, shared] = await Promise.all([
    workspaceDocumentsFor(userId,groupId),
    email && !groupId ? workspaceSharedFor(userId, email) : [],
  ]);
  return {
    artifacts: artifacts.map((artifact) => ({
      ...artifact, url: `/a/${artifact.id}`,
    })), shared,
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
