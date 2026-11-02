/** Account library and view/engagement insights; anonymous callers receive the landing response. `part=bootstrap` is the Home destination and its shelf in one answer. */
import { json } from '@/lib/http';
import { sessionActor } from '@/lib/authentication';
import { accountWorkspaceFor, accountWorkspaceCoreFor, accountWorkspaceInsightsFor, homeBootstrapFor } from '@/lib/workspace';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const user = actor.credential === 'session' && actor.userId ? actor : null;
  const part = new URL(request.url).searchParams.get('part');
  const groupId=new URL(request.url).searchParams.get('groupId')??undefined;
  if (part === 'bootstrap') {
    const personal = new URL(request.url).searchParams.get('personal') === '1';
    return json(await homeBootstrapFor(user?.userId ? { userId: user.userId, email: user.email } : null, { personal }), 200, { 'Cache-Control': 'no-store' });
  }
  if (!user?.userId) return json({ signedIn: false }, 200, { 'Cache-Control': 'no-store' });
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
