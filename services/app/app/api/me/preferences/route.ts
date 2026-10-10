import {groupRoute} from '@/lib/groups/http';
import {getAccountPreferences,setAccountPreferences} from '@/lib/groups';
import {json,readJson} from '@/lib/http';
export const GET=groupRoute(async(_request,userId)=>json(await getAccountPreferences(userId)),true);
export const PUT=groupRoute(async(request,userId)=>{const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);return json(await setAccountPreferences(userId,body.default_destination as import('@artifactbin/contracts').DefaultDestination));});
