/**
 * The dashboard's data: a stranger gets the landing; an account gets its
 * library (with each document's view sparkline, rendered here as SVG so the
 * page draws nothing, plus one pooled 30-day series), what is shared with it,
 * and the two activity lists —
 * what happened to its documents, and what the people it follows did in
 * public. Both come decorated (handles, titles) because the SPA holds no
 * database and must not spend a request per row learning names.
 */
import { liveAgentSession } from '@/lib/agent-session';
import { json } from '@/lib/http';
import { listDraftsByTokenIds } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';
import { accountWorkspaceFor, accountWorkspaceCoreFor, accountWorkspaceInsightsFor } from '@/lib/workspace';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const user = actor.credential === 'session' && actor.viewer?.userId ? actor.viewer : null;
  const part = new URL(request.url).searchParams.get('part');
  if (!user?.userId) {
    if (part === 'insights') return json({ signedIn: false }, 200, { 'Cache-Control': 'no-store' });
    const cookie = actor.heldTokenIds
      ? null
      : await liveAgentSession(request);
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
  if (part === 'core' || part === 'insights') {
    return json({ signedIn: true, accountId: user.userId, ...(await (part === 'core'
      ? accountWorkspaceCoreFor(user.userId, user.email)
      : accountWorkspaceInsightsFor(user.userId))) }, 200, { 'Cache-Control': 'no-store' });
  }
  return json({
    signedIn: true,
    ...(await accountWorkspaceFor(user.userId, user.email)),
  }, 200, { 'Cache-Control': 'no-store' });
}
