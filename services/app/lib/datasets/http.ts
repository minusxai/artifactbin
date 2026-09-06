import {requestOrSessionActor,actorForArtifacts} from '@/lib/viewer';
import {refusesCrossSite} from '@/lib/auth';
import {json,unauthorized} from '@/lib/http';
import {DatasetError} from './connections';
export async function datasetActor(request:Request){
 const actor=await requestOrSessionActor(request);
 if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);
 return actorForArtifacts(actor)??unauthorized(request);
}
export async function datasetResponse(work:()=>Promise<unknown>,status=200):Promise<Response>{
 try{return json(await work(),status);}catch(error){return json({error:'dataset_error',details:[error instanceof Error?error.message:'Dataset request failed']},error instanceof DatasetError?error.status:400);}
}
