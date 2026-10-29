import { sessionActor } from '@/lib/authentication';
import {commentImageResponse} from '@/lib/annotations';
export async function GET(request:Request,ctx:{params:Promise<{id:string;imageId:string}>}){
 const actor=await sessionActor(request);
 const {id,imageId}=await ctx.params;
 return commentImageResponse(actor,id,imageId,new URL(request.url).searchParams.get('variant')??'preview');
}
