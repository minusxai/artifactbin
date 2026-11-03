import type {MutationOperationRequest, MutationOperationSuccess} from '@artifactbin/contracts';
import type { MutationReply } from '@/lib/artifacts';

/** Only explicit caller inputs belong in the fingerprint; server defaults are pinned separately. */
export function normalizeMutationOperation(request:MutationOperationRequest):MutationOperationRequest{
 return {documentId:request.documentId,mutation:request.mutation,args:request.args,
 ...(request.row!==undefined?{row:request.row}:{}),...(request.value!==undefined?{value:request.value}:{}),
 ...(request.tz!==undefined?{tz:request.tz}:{}),...(request.expectedState!==undefined?{expectedState:request.expectedState}:{})};
}
export function adaptMutationOperationReply(reply:MutationReply,route:'api'|'browser'):MutationReply{
 const value=reply.body.mutationOperation as MutationOperationSuccess|undefined;
 if(!value)return reply;
 return {...reply,body:{...(route==='browser'?{ok:true,dataset:value.datasetId}:{id:value.datasetId}),version:value.version,affected:value.affected,rowCount:value.rowCount}};
}
