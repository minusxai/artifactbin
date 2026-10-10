import {groupRoute} from '@/lib/group-routes';
import {inviteGroupMember} from '@/lib/groups';
import {json,readJson} from '@/lib/http';
export const POST=groupRoute(async(request,userId,{id})=>{const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);return json(await inviteGroupMember(userId,id,body.email as string,body.role as import('@artifactbin/contracts').GroupRole),201);});
