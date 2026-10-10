import {groupRoute} from '@/lib/group-routes';
import {searchGroupMembers} from '@/lib/groups';
import {json} from '@/lib/http';
export const GET=groupRoute(async(request,userId,{id})=>json({members:await searchGroupMembers(userId,id,new URL(request.url).searchParams.get('query')??'')}),true);
