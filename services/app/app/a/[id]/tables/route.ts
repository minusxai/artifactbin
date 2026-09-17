import {getArtifactById,effectiveRole} from '@/lib/artifacts';
import {canRead} from '@/lib/share-roles';
import {requestOrSessionActor} from '@/lib/viewer';
import {readJson,json} from '@/lib/http';
import {catalogOf} from '@/lib/datasets/catalog';
import {datasetResponse} from '@/lib/datasets/http';
import {executeCatalog} from '@/lib/datasets/execute';
import {DatasetError} from '@/lib/datasets/errors';
import {REVALIDATE_ACTOR_HEADER} from '@artifactbin/contracts';
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const {id}=await ctx.params;const actor=await requestOrSessionActor(request);const row=await getArtifactById(id);
 if(!row||row.format!=='dataset'||!canRead(await effectiveRole(row,{userId:actor.viewer?.userId??null,tokenId:actor.tokenId,email:actor.viewer?.email})))return json({error:'not_found'},404);
 const body=await readJson(request);if(!body||typeof body.sql!=='string')return json({error:'invalid_query'},400);
 const catalog=catalogOf(row);if(!catalog)return json({error:'invalid_dataset'},400);
 return datasetResponse(()=>executeCatalog(catalog,body.sql as string,{}, {datasetId:id,limit:typeof body.limit==='number'?body.limit:100,offset:typeof body.offset==='number'?body.offset:0,refresh:body.refresh===true,signal:request.signal,authorize:async()=>{
  const currentActor=await requestOrSessionActor(request),current=await getArtifactById(id);
  if(!current||!canRead(await effectiveRole(current,{userId:currentActor.viewer?.userId??null,tokenId:currentActor.tokenId,email:currentActor.viewer?.email}))||JSON.stringify(catalogOf(current))!==JSON.stringify(catalog))throw new DatasetError('Dataset not found',404);
 }}),200,{[REVALIDATE_ACTOR_HEADER]:'1'});
}
