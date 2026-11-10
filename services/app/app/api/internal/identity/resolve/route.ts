/** POST /api/internal/identity/resolve — contracts `IDENTITY_PATHS.resolve` (cross-repository contract §2). */
import {identityServiceRoute} from '@/lib/group-routes';
import {resolveIdentity} from '@/lib/groups';
const optional=(value:unknown)=>value===undefined||value===null?undefined:typeof value==='string'&&value?value:false;
export const POST=identityServiceRoute(async body=>{
 const user=optional(body.user_id),session=optional(body.session_id),group=optional(body.group_id);
 // token_id is the auth host's to answer (token_active); here it need only be well formed.
 if(user===false||session===false||group===false||optional(body.token_id)===false)return null;
 return resolveIdentity({...(user?{user_id:user}:{}),...(session?{session_id:session}:{}),...(group?{group_id:group}:{})});
});
