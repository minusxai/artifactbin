import {getUserById} from '@/lib/users';
import {json} from '@/lib/http';
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){
 const user=await getUserById((await ctx.params).id);
 if(!user?.username||user.kind!=='account')return json({error:'not_found'},404);
 return Response.redirect(new URL(`/@${user.username}`,request.url),302);
}
