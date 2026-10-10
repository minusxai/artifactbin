/** Account library and view/engagement insights; anonymous callers receive landing or held drafts. */
import { liveAgentSession } from '@/lib/accounts';
import { json } from '@/lib/http';
import { sessionActor } from '@/lib/accounts';
import { accountWorkspaceFor, accountWorkspaceCoreFor, accountWorkspaceInsightsFor, listDraftsByTokenIds } from '@/lib/workspace';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const user = actor.credential === 'session' && actor.viewer?.userId ? actor.viewer : null;
  const part = new URL(request.url).searchParams.get('part');
  const groupId=new URL(request.url).searchParams.get('groupId')??undefined;
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
  if(groupId){
    const core=await accountWorkspaceCoreFor(user.userId,user.email,groupId);
    return core?json({signedIn:true,accountId:user.userId,...core},200,{'Cache-Control':'no-store'}):json({error:'not_found'},404);
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
