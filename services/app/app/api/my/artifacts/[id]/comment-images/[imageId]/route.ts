import {sessionActor,actorForArtifacts} from '@/lib/accounts';
import {commentImageResponse} from '@/lib/annotations';
export async function GET(request:Request,ctx:{params:Promise<{id:string;imageId:string}>}){
 const viewer=await sessionActor(request);
 const actor=actorForArtifacts(viewer)??{tokenId:'',userId:null};
 const {id,imageId}=await ctx.params;
 return commentImageResponse(actor,id,imageId,new URL(request.url).searchParams.get('variant')??'preview');
}
