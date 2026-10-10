import {groupRoute} from '@/lib/groups/http';
import {removeGroupInvitation} from '@/lib/groups';
import {json} from '@/lib/http';
export const DELETE=groupRoute(async(_request,userId,{id,invitationId})=>{await removeGroupInvitation(userId,id,invitationId);return json({ok:true});});
