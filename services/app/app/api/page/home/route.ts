/**
 * The dashboard's data: a stranger gets the landing; an account gets its
 * library (with each document's view sparkline, rendered here as SVG so the
 * page draws nothing, plus one pooled 30-day series), what is shared with it,
 * and the two activity lists —
 * what happened to its documents, and what the people it follows did in
 * public. Both come decorated (handles, titles) because the SPA holds no
 * database and must not spend a request per row learning names.
 */
import { AGENT_COOKIE, decodeAgentSession } from '@/lib/agent-session';
import { decorateFeed, followFeed, likeSummaryByUser, ownerFeed, VIEW_SERIES_DAYS, viewSeriesByUser } from '@/lib/feed';
import { json, parseCookie } from '@/lib/http';
import { listArtifactsByUser, listDraftsByTokenIds, listSharedWithEmail } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';
import { renderSparklineSvg } from '@/lib/viz/sparkline';

/** How much activity the dashboard's two lists show. Short on purpose: this is a glance, not a history. */
const ACTIVITY_LIMIT = 20;

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const user = actor.credential === 'session' && actor.viewer?.userId ? actor.viewer : null;
  if (!user?.userId) {
    const cookie = actor.heldTokenIds
      ? null
      : await decodeAgentSession(parseCookie(request.headers.get('cookie'), AGENT_COOKIE));
    const heldTokenIds = actor.heldTokenIds ?? cookie?.tokenIds;
    if (!heldTokenIds?.length) return json({ signedIn: false }, 200, { 'Cache-Control': 'no-store' });
    const drafts = await listDraftsByTokenIds(heldTokenIds);
    return json({
      signedIn: false,
      drafts: drafts.map((draft) => ({
        id: draft.id, url: `/a/${draft.id}`, title: draft.title, format: draft.format,
        version: draft.version, updated_at: draft.updated_at, visibility: draft.visibility,
      })),
    }, 200, { 'Cache-Control': 'no-store' });
  }
  const artifacts = await listArtifactsByUser(user.userId);
  const documents = artifacts.filter((artifact) => artifact.format === 'markup');
  /*
   * PLACEMENT is the owner's business, and the shared half is somebody else's
   * row: `listSharedWithEmail` selects the summary columns, so `ancestor_ids`
   * would hand every invited person the ids of the folders on their inviter's
   * shelf — addresses they meet the uniform 404 at. The same projection rule
   * the public profile follows. The viewer's OWN artifacts keep it below,
   * because that is what draws their shelf.
   */
  const shared = (user.email ? await listSharedWithEmail(user.email, user.userId) : [])
    .map(({ ancestor_ids: _placement, ...row }) => row);
  const [series, likes] = documents.length
    ? await Promise.all([viewSeriesByUser(user.userId), likeSummaryByUser(user.userId)])
    : [new Map<string, number[]>(), { total: 0, series: new Array<number>(VIEW_SERIES_DAYS).fill(0) }];
  const sparklines: Record<string, string> = {};
  for (const a of documents) {
    const s = series.get(a.id);
    if (s?.some((n) => n > 0)) sparklines[a.id] = await renderSparklineSvg(s);
  }
  const [mine, following] = await Promise.all([
    ownerFeed(user.userId, { limit: ACTIVITY_LIMIT }).then(decorateFeed),
    followFeed(user.userId, { limit: ACTIVITY_LIMIT }).then(decorateFeed),
  ]);
  // The dashboard is about the library as a whole, not a leaderboard. Pool
  // the same exact 30 daily buckets that feed the per-artifact shelf splines.
  const viewsOverTime = new Array<number>(VIEW_SERIES_DAYS).fill(0);
  for (const artifact of documents) {
    const buckets = series.get(artifact.id) ?? [];
    buckets.forEach((views, day) => { viewsOverTime[day] += views; });
  }
  return json({
    signedIn: true,
    feed: { mine, following },
    artifacts: artifacts.map((a) => ({
      id: a.id, url: `/a/${a.id}`, title: a.title, format: a.format, version: a.version, ancestor_ids: a.ancestor_ids,
      visibility: a.visibility, updated_at: a.updated_at, views: a.views, sparkline: sparklines[a.id] ?? null,
    })),
    viewsOverTime,
    likes: likes.total,
    likesOverTime: likes.series,
    shared,
  }, 200, { 'Cache-Control': 'no-store' });
}
