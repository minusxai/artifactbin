import {sessionActor,actorForArtifacts} from '@/lib/viewer';
import {json} from '@/lib/http';
import {readCommentImage} from '@/lib/comment-images';
export async function GET(request:Request,ctx:{params:Promise<{id:string;imageId:string}>}){
 const viewer=await sessionActor(request);
 const actor=actorForArtifacts(viewer)??{tokenId:'',userId:null};
 const {id,imageId}=await ctx.params;
 const result=await readCommentImage(actor,id,imageId,new URL(request.url).searchParams.get('variant')??'preview');
 return result?new Response(new Uint8Array(result.buffer),{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}):json({error:'not_found'},404);
}
