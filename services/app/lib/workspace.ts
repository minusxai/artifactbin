/**
 * The signed-in account workspace shared by Home and an owned folder page.
 *
 * Location changes only the shelf. Dashboard totals, engagement, activity and
 * shortcuts describe the account as a whole, so they are computed once here
 * and travel unchanged to either page.
 */
import { decorateFeed, followFeed, forkCountByUser, likeSummaryByUser, ownerFeed, VIEW_SERIES_DAYS, viewSeriesByUser } from '@/lib/feed';
import { count } from '@/lib/relations';
import { listArtifactsByUser, listSharedWithEmail } from '@/lib/users';
import { renderSparklineSvg } from '@/lib/viz/sparkline';

const ACTIVITY_LIMIT = 20;

export async function accountWorkspaceCoreFor(userId: string, email?: string | null) {
  const [artifacts, sharedRows] = await Promise.all([
    listArtifactsByUser(userId), email ? listSharedWithEmail(email, userId) : Promise.resolve([]),
  ]);
  const shared = sharedRows
    .map(({ ancestor_ids: _placement, ...row }) => row);
  return {
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id, url: `/a/${artifact.id}`, title: artifact.title, format: artifact.format,
      version: artifact.version, ancestor_ids: artifact.ancestor_ids, visibility: artifact.visibility,
      updated_at: artifact.updated_at, views: artifact.views, sparkline: null as string | null,
    })), shared,
  };
}

/** No shelf query here: account-wide series already identify their documents. */
export async function accountWorkspaceInsightsFor(userId: string) {
  const [series, likes, mine, following, followers, forks] = await Promise.all([
    viewSeriesByUser(userId, VIEW_SERIES_DAYS, 'markup'), likeSummaryByUser(userId),
    ownerFeed(userId, { limit: ACTIVITY_LIMIT }).then(decorateFeed),
    followFeed(userId, { limit: ACTIVITY_LIMIT }).then(decorateFeed),
    count('follow', userId), forkCountByUser(userId),
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
    feed: { mine, following },
    sparklines,
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
  return { ...core, ...insights, artifacts: core.artifacts.map((row) => ({ ...row, sparkline: sparklines[row.id] ?? null })) };
}

export type AccountWorkspaceCore = Awaited<ReturnType<typeof accountWorkspaceCoreFor>>;
export type AccountWorkspaceInsights = Awaited<ReturnType<typeof accountWorkspaceInsightsFor>>;

export type AccountWorkspace = Awaited<ReturnType<typeof accountWorkspaceFor>>;
