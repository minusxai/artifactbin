import {getUserById} from '@/lib/users';
import {json} from '@/lib/http';
export async function GET(_request:Request,ctx:{params:Promise<{id:string}>}){
 const user=await getUserById((await ctx.params).id);
 if(!user?.username||user.kind!=='account')return json({error:'not_found'},404);
 return new Response(null,{status:302,headers:{Location:`/@${encodeURIComponent(user.username)}`,'Cache-Control':'no-store'}});
}
