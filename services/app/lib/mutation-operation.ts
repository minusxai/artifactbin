import type {MutationInitiator, MutationOperationRequest, MutationOperationSuccess, Queryable} from '@artifactbin/contracts';
import type {TokenActor} from './artifacts';
import {completeMutationReceipt,type MutationReceipt,type MutationReply} from './mutation-receipt';

/** Only explicit caller inputs belong in the fingerprint; server defaults are pinned separately. */
export function normalizeMutationOperation(request:MutationOperationRequest):MutationOperationRequest{
 return {documentId:request.documentId,mutation:request.mutation,args:request.args,
 ...(request.row!==undefined?{row:request.row}:{}),...(request.value!==undefined?{value:request.value}:{}),
 ...(request.tz!==undefined?{tz:request.tz}:{}),...(request.expectedState!==undefined?{expectedState:request.expectedState}:{})};
}
export function mutationInitiator(actor:Pick<TokenActor,'userId'|'tokenId'>,execution:'human'|'agent',agentLabel:string|null=null):MutationInitiator{
 return {principal:actor.tokenId?{kind:'token',id:actor.tokenId}:actor.userId?{kind:'user',id:actor.userId}:{kind:'anonymous'},execution,agentLabel};
}
export const documentMutationReply=(success:MutationOperationSuccess):MutationReply=>({status:200,body:{mutationOperation:success}});
export async function completeDocumentMutationReceipt(tx:Queryable,receipt:MutationReceipt,success:MutationOperationSuccess):Promise<void>{
 await completeMutationReceipt(tx,receipt,documentMutationReply(success));
}
export function adaptMutationOperationReply(reply:MutationReply,route:'api'|'browser'):MutationReply{
 const value=reply.body.mutationOperation as MutationOperationSuccess|undefined;
 if(!value)return reply;
 return {...reply,body:{...(route==='browser'?{ok:true,dataset:value.datasetId}:{id:value.datasetId}),version:value.version,affected:value.affected,rowCount:value.rowCount,...(value.mutationRunId?{mutationRunId:value.mutationRunId}:{})}};
}
