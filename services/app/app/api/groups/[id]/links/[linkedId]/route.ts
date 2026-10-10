import {groupRoute} from '@/lib/groups/http';
import {setGroupLink} from '@/lib/groups';
import {json} from '@/lib/http';
export const PUT=groupRoute(async(_request,userId,{id,linkedId})=>{await setGroupLink(userId,id,linkedId,true);return json({ok:true});});
export const DELETE=groupRoute(async(_request,userId,{id,linkedId})=>{await setGroupLink(userId,id,linkedId,false);return json({ok:true});});
