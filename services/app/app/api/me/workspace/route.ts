/** Agent reads of the same personal inventories as the Home shelves. */
import {withTokenAuth} from '@/lib/authentication';
import {json} from '@/lib/http';
import {workspaceLikedFor, workspaceSharedFor} from '@/lib/workspace';

export const GET=withTokenAuth(async(request,{actor})=>{
  if(!request.headers.has('authorization')||actor.credential!=='bearer'||!actor.userId)return json({error:'account_required'},403);
  const part=new URL(request.url).searchParams.get('part');
  if(part!=='liked' && part!=='shared')return json({error:'invalid_part'},400);
  const artifacts=part==='liked' ? await workspaceLikedFor(actor)
    : actor.emailVerified && actor.email ? await workspaceSharedFor(actor.userId,actor.email) : [];
  return json({artifacts},200,{'Cache-Control':'no-store'});
},{readOnly:true});
