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

export async function accountWorkspaceFor(userId: string, email?: string | null) {
  const artifacts = await listArtifactsByUser(userId);
  const documents = artifacts.filter((artifact) => artifact.format === 'markup');
  const shared = (email ? await listSharedWithEmail(email, userId) : [])
    .map(({ ancestor_ids: _placement, ...row }) => row);
  const [series, likes] = documents.length
    ? await Promise.all([viewSeriesByUser(userId), likeSummaryByUser(userId)])
    : [new Map<string, number[]>(), { total: 0, series: new Array<number>(VIEW_SERIES_DAYS).fill(0) }];

  const sparklines: Record<string, string | undefined> = {};
  for (const artifact of documents) {
    const values = series.get(artifact.id);
    if (values?.some((value) => value > 0)) sparklines[artifact.id] = await renderSparklineSvg(values);
  }

  const [mine, following, followers, forks] = await Promise.all([
    ownerFeed(userId, { limit: ACTIVITY_LIMIT }).then(decorateFeed),
    followFeed(userId, { limit: ACTIVITY_LIMIT }).then(decorateFeed),
    count('follow', userId),
    documents.length ? forkCountByUser(userId) : Promise.resolve(0),
  ]);

  const viewsOverTime = new Array<number>(VIEW_SERIES_DAYS).fill(0);
  for (const artifact of documents) {
    const buckets = series.get(artifact.id) ?? [];
    buckets.forEach((views, day) => { viewsOverTime[day] += views; });
  }

  return {
    feed: { mine, following },
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      url: `/a/${artifact.id}`,
      title: artifact.title,
      format: artifact.format,
      version: artifact.version,
      ancestor_ids: artifact.ancestor_ids,
      visibility: artifact.visibility,
      updated_at: artifact.updated_at,
      views: artifact.views,
      sparkline: sparklines[artifact.id] ?? null,
    })),
    viewsOverTime,
    likes: likes.total,
    likesOverTime: likes.series,
    followers,
    forks,
    shared,
  };
}

export type AccountWorkspace = Awaited<ReturnType<typeof accountWorkspaceFor>>;
