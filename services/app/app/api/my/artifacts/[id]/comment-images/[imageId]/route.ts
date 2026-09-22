import {sessionActor,actorForArtifacts} from '@/lib/viewer';
import {commentImageResponse} from '@/lib/comment-images';
export async function GET(request:Request,ctx:{params:Promise<{id:string;imageId:string}>}){
 const viewer=await sessionActor(request);
 const actor=actorForArtifacts(viewer)??{tokenId:'',userId:null};
 const {id,imageId}=await ctx.params;
 return commentImageResponse(actor,id,imageId,new URL(request.url).searchParams.get('variant')??'preview');
}
