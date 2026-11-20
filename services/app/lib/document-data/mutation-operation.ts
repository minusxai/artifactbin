import type { Scalar } from '@artifactbin/contracts/sql';
import type { MutationReply } from '@/lib/artifacts';

/** Canonical explicit request inputs for persistent document-action replay. */
export interface MutationOperationRequest {
  documentId: string;
  mutation: string;
  args: Record<string, Scalar>;
  row?: Record<string, Scalar>;
  value?: Scalar;
  tz?: string;
  expectedState?: string;
}

/**
 * Persist this successful domain outcome once; route adapters render it to their
 * existing API/browser shapes on BOTH first response and replay. No effect images.
 */
interface MutationOperationSuccess {
  datasetId: string;
  datasetEditId: string;
  version: number;
  affected: number;
  rowCount: number;
}


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
