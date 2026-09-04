/**
 * The dashboard's data: a stranger gets the landing; an account gets its
 * library (with each document's view sparkline, rendered here as SVG so the
 * page draws nothing), and what is shared with it.
 */
import { viewSeriesByUser } from '@/lib/analytics';
import { AGENT_COOKIE, decodeAgentSession } from '@/lib/agent-session';
import { json, parseCookie } from '@/lib/http';
import { listArtifactsByUser, listDraftsByTokenIds, listSharedWithEmail } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';
import { renderSparklineSvg } from '@/lib/viz/sparkline';

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
  const shared = user.email ? await listSharedWithEmail(user.email, user.userId) : [];
  const series = artifacts.length ? await viewSeriesByUser(user.userId) : new Map<string, number[]>();
  const sparklines: Record<string, string> = {};
  for (const a of artifacts) {
    const s = series.get(a.id);
    if (s?.some((n) => n > 0)) sparklines[a.id] = await renderSparklineSvg(s);
  }
  return json({
    signedIn: true,
    artifacts: artifacts.map((a) => ({
      id: a.id, url: `/a/${a.id}`, title: a.title, format: a.format, version: a.version, ancestor_ids: a.ancestor_ids,
      visibility: a.visibility, updated_at: a.updated_at, views: a.views, sparkline: sparklines[a.id] ?? null,
    })),
    shared,
  }, 200, { 'Cache-Control': 'no-store' });
}
