/**
 * The signed-in account workspace shared by Home and an owned folder page.
 *
 * Location changes only the shelf. Dashboard totals, engagement, activity and
 * shortcuts describe the account as a whole, so they are computed once here
 * and travel unchanged to either page.
 */
import { decorateFeed, followFeed, forkCountByUser, likeSummaryByUser, ownerFeed, VIEW_SERIES_DAYS, viewSeriesByUser } from '@/lib/feed';
import { count } from '@/lib/relations';
import { LIVE_ARTIFACT_SQL } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import type { SharedArtifactSummary } from '@/lib/users';
import { renderSparklineSvg } from '@/lib/viz/sparkline';
import { workspaceDocumentsFor, workspaceStatsFor } from '@/lib/workspace-inventory';

const ACTIVITY_LIMIT = 20;

// Workspace projections deliberately exclude source metadata and engagement.
// Discovery keeps the same ownership/share/trash gates as the general listings.
export type WorkspaceSharedItem = Pick<SharedArtifactSummary, 'id' | 'title' | 'description' | 'format' | 'version' | 'visibility' | 'updated_at' | 'owner_username' | 'role'>;

export async function accountWorkspaceCoreFor(userId: string, email?: string | null) {
  const db = await getDb();
  const [artifacts, shared] = await Promise.all([
    workspaceDocumentsFor(userId),
    email ? db.query<WorkspaceSharedItem>(`SELECT a.id, a.title, a.description, a.format, a.version, a.visibility, a.updated_at, u.username AS owner_username, s.role
      FROM artifacts a JOIN artifact_shares s ON s.artifact_id = a.id LEFT JOIN users u ON u.id = a.user_id
      WHERE s.email = $1 AND a.user_id IS DISTINCT FROM $2::text AND a.${LIVE_ARTIFACT_SQL}
      ORDER BY a.updated_at DESC LIMIT 200`, [email.toLowerCase().trim(), userId]) : { rows: [] },
  ]);
  return {
    artifacts: artifacts.map((artifact) => ({
      ...artifact, url: `/a/${artifact.id}`, sparkline: null as string | null,
    })), shared: shared.rows,
  };
}

/** Lifetime visitor semantics stay identical to the old per-row subquery. */
async function workspaceViewCounts(userId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const result = await db.query<{ id: string; views: number }>(`SELECT a.id, COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int AS views
    FROM artifacts a LEFT JOIN analytics_events e ON e.artifact_id = a.id AND e.event = 'view'
    WHERE a.user_id = $1 AND a.${LIVE_ARTIFACT_SQL} GROUP BY a.id`, [userId]);
  return Object.fromEntries(result.rows.map(row => [row.id, row.views]));
}

/** No shelf query here: account-wide series already identify their documents. */
export async function accountWorkspaceInsightsFor(userId: string) {
  const [series, likes, mine, following, followers, forks, views, stats] = await Promise.all([
    viewSeriesByUser(userId, VIEW_SERIES_DAYS, 'markup'), likeSummaryByUser(userId),
    ownerFeed(userId, { limit: ACTIVITY_LIMIT }).then(decorateFeed),
    followFeed(userId, { limit: ACTIVITY_LIMIT }).then(decorateFeed),
    count('follow', userId), forkCountByUser(userId), workspaceViewCounts(userId), workspaceStatsFor(userId),
  ]);

  const sparklines: Record<string, string | undefined> = {};
  for (const [id, values] of series) {
    if (values.some((value) => value > 0)) sparklines[id] = await renderSparklineSvg(values);
  }

  const viewsOverTime = new Array<number>(VIEW_SERIES_DAYS).fill(0);
  for (const buckets of series.values()) {
    buckets.forEach((views, day) => { viewsOverTime[day] += views; });
  }

  return {
    stats,
    feed: { mine, following },
    sparklines,
    views,
    viewsOverTime,
    likes: likes.total,
    likesOverTime: likes.series,
    followers,
    forks,
  };
}

export async function accountWorkspaceFor(userId: string, email?: string | null) {
  const [core, { sparklines, ...insights }] = await Promise.all([
    accountWorkspaceCoreFor(userId, email), accountWorkspaceInsightsFor(userId),
  ]);
  return { ...core, ...insights, artifacts: core.artifacts.map((row) => ({ ...row, views: insights.views[row.id] ?? 0, sparkline: sparklines[row.id] ?? null })) };
}

export type AccountWorkspaceCore = Awaited<ReturnType<typeof accountWorkspaceCoreFor>>;
export type AccountWorkspaceInsights = Awaited<ReturnType<typeof accountWorkspaceInsightsFor>>;

export type AccountWorkspace = Awaited<ReturnType<typeof accountWorkspaceFor>>;
