import {groupRoute} from '@/lib/groups/http';
import {getGroupDetail} from '@/lib/groups';
import {json} from '@/lib/http';
export const GET=groupRoute(async(_request,userId,{id})=>{const detail=await getGroupDetail(userId,id);return detail?json(detail):json({error:'not_found'},404);},true);
