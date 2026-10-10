import {groupRoute} from '@/lib/group-routes';
import {setGroupMember,removeGroupMember} from '@/lib/groups';
import {json,readJson} from '@/lib/http';
export const PUT=groupRoute(async(request,actor,{id,userId})=>{const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);await setGroupMember(actor,id,userId,body.role as import('@artifactbin/contracts').GroupRole);return json({ok:true});});
export const DELETE=groupRoute(async(_request,actor,{id,userId})=>{await removeGroupMember(actor,id,userId);return json({ok:true});});
