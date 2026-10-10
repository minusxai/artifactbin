import {groupRoute} from '@/lib/group-routes';
import {createGroup,listGroups} from '@/lib/groups';
import {json,readJson} from '@/lib/http';
export const GET=groupRoute(async(_request,userId)=>json({groups:await listGroups(userId)}),true);
export const POST=groupRoute(async(request,userId)=>{const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);return json(await createGroup(userId,body as unknown as import('@artifactbin/contracts').CreateGroupInput),201);});
