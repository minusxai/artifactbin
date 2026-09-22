import {browserActor} from '@/lib/auth';
import {actorForArtifacts} from '@/lib/viewer';
import {capabilityGuard} from '@/lib/capabilities';
import {json,unauthorized} from '@/lib/http';
import {stageCommentImage} from '@/lib/comment-images';
import {COMMENT_IMAGE_LIMITS} from '../../../../../../../contracts/src/comment-image';

export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const viewer=await browserActor(request);if(viewer instanceof Response)return viewer;
 const actor=actorForArtifacts(viewer);if(!actor)return unauthorized(request);
 const {id}=await ctx.params;const refusal=await capabilityGuard(actor,'comment',id);if(refusal)return refusal;
 // Bound the stream before parsing multipart, including requests without Content-Length.
 const reader=request.body?.getReader();if(!reader)return json({error:'invalid_image'},400);
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>COMMENT_IMAGE_LIMITS.bytes*2+1024*1024){await reader.cancel();return json({error:'image_too_large'},413);}chunks.push(value);}
 try{
  const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData();
  const original=form.get('original'),preview=form.get('preview'),metadata=form.get('metadata');
  if(!(original instanceof Blob)||!(preview instanceof Blob)||typeof metadata!=='string'||metadata.length>1024*1024)return json({error:'invalid_image'},400);
  const result=await stageCommentImage(actor,id,Buffer.from(await original.arrayBuffer()),Buffer.from(await preview.arrayBuffer()),JSON.parse(metadata));
  return result instanceof Response?result:json(result,201);
 }catch{return json({error:'invalid_image'},400);}
}
