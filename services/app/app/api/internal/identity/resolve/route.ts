/** POST /api/internal/identity/resolve — contracts `IDENTITY_PATHS.resolve` (cross-repository contract §2). */
import {identityServiceRoute} from '@/lib/group-routes';
import {resolveIdentity} from '@/lib/groups';
const optional=(value:unknown)=>value===undefined||value===null?undefined:typeof value==='string'&&value?value:false;
export const POST=identityServiceRoute(async body=>{
 const session=optional(body.session_id),group=optional(body.group_id);
 if(typeof body.user_id!=='string'||!body.user_id||session===false||group===false)return null;
 return resolveIdentity({user_id:body.user_id,...(session?{session_id:session}:{}),...(group?{group_id:group}:{})});
});
