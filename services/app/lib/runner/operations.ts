import {createHash} from 'node:crypto';
import {z} from 'zod';
import {actorOf} from '@artifactbin/utils';
import { adaptMutationOperationReply, type ArtifactRow, canReadArtifact, dataflowForRow, durableMutation, getArtifactById, mutationInitiator, runDocumentMutation } from '@/lib/artifacts';
import { parseMutationRequest } from '@/lib/dataflow';
import {json} from '../http';
const scalar=z.union([z.string(),z.number().finite(),z.boolean(),z.null()]);
const query=z.object({values:z.record(z.string(),scalar),only:z.array(z.string()),localTables:z.record(z.string(),z.array(z.record(z.string(),scalar))).optional()}).strict();
/** Only runner-host attested snapshots reach this boundary. Current ACLs are never snapshotted. */
export async function lambdaOperation(request:Request,operation:string,input:Record<string,unknown>,source?:string):Promise<Response>{
 const identity=actorOf(request), pin=identity?.runner, userId=identity?.userId;
 if(!pin||!userId||typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==pin.sourceHash)return json({error:'invalid_runner_context'},403);
 const authorize=async()=>{
  const row=await getArtifactById(pin.artifactId);
  if(!row||row.deleted_at||!await canReadArtifact(row,{userId,email:null}))throw Error('not_found');
  return row;
 };
 try{
  const current=await authorize();
  if(current.format!=='markup'||!/^\d+$/.test(pin.version))return json({error:'not_executable'},400);
  // Recompile pinned declarations, but resolve dataset grants and account ownership afresh.
  const doc:ArtifactRow={...current,source,document:null,meta:{},version:Number(pin.version),edit_id:pin.editId};
  const actor={userId,tokenId:''};
  if(operation==='lambda_query'){
   const parsed=query.safeParse(input);if(!parsed.success)return json({error:'invalid_query'},400);
   const result=await dataflowForRow(doc,{...parsed.data,viewer:actor,authorize:async()=>{await authorize();},signal:request.signal});
   await authorize();
   return json(result?.state??{tables:{},errors:{}});
  }
  if(operation!=='lambda_mutate')return json({error:'operation_not_allowed'},403);
  const parsed=parseMutationRequest(input);if(parsed instanceof Response)return parsed;
  // The program's operationKey is not the execution identity. One trusted RPC call has one receipt.
  const key=createHash('sha256').update(`${pin.runId}:${pin.callId}`).digest('hex');
  const saved=await durableMutation(actor,'http://artifactbin.runner',key,{artifactId:pin.artifactId,version:pin.version,sourceHash:pin.sourceHash,input},async receipt=>{
   await authorize();
   const result=await runDocumentMutation(doc,parsed,actor,receipt);
   if(!result.ok)return {status:result.capability?.status??400,body:{error:result.reason,detail:result.detail??result.reason}};
   return {status:200,body:'local' in result?{dataset:'',local:result.local}:{dataset:result.dataset.id,...(result.mutationRunId?{mutationRunId:result.mutationRunId}:{})}};
  },{initiator:mutationInitiator(actor,'agent','Lambda')});
  const result=adaptMutationOperationReply(saved,'browser');return json(result.body,result.status);
 }catch(error){const message=error instanceof Error?error.message:'lambda_operation_failed';return json({error:message},message==='not_found'?404:400);}
}
