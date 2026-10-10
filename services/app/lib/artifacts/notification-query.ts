/** Notification shaping over the same server query execution used by document reads. */
import {NOTIFICATION_QUERY_LIMITS,type MutationNotificationJobInput,type MutationNotificationPlan,type NotificationSource,type TableResult} from '@artifactbin/contracts';
import {NotificationExecutionError} from '@/lib/notifications/errors';
import {notificationQueryContext,notificationRuleSourceIds} from '@/lib/notifications/context';
import {notificationArtifactAuthority,notificationExecutionFence,notificationExecutionSource,notificationPrincipal} from './notification-authority';
import {executeDocumentQueries,type DocumentQuerySource,type DocumentQuerySourceMode} from '@/lib/datasets/document-queries';
import {selectQueries} from '@/lib/dataflow';
import {platformValues} from '@/lib/dataflow';
import {DataflowResultError} from '@/lib/dataflow/evaluate';
import {getDb} from '@/lib/platform/db';
import { tableForRef, acceptedMembers } from './dataflow';
import type { RoleActor } from '@/lib/accounts';
import type {Row} from '@/lib/dataflow';
export interface NotificationQueryDependencies {
 load(input:MutationNotificationJobInput):Promise<{
  executionFence:MutationNotificationPlan['executionFence'];members:Row[];actor:RoleActor;
  resolve(ref:string,mode?:DocumentQuerySourceMode):Promise<DocumentQuerySource|null>;
  receipt(ref:string):NotificationSource|undefined;
  authorize():Promise<void>;
 }>;
}
/** Validate the entire result before returning any candidate; the job store aggregates recipients across rules. */
export function normalizeNotificationResult(table:TableResult):MutationNotificationPlan['rules'][number]['rows'] {
 const limits=NOTIFICATION_QUERY_LIMITS;
 if(table.truncated||table.rows.length>limits.rows||(table.totalRows!==undefined&&table.totalRows>table.rows.length))throw new NotificationExecutionError('notification_capacity');
 if(table.columns.length!==2||!table.columns.some(c=>c.name==='to')||!table.columns.some(c=>c.name==='message'))throw new NotificationExecutionError('notification_output_invalid');
 if(Buffer.byteLength(JSON.stringify(table.rows),'utf8')>limits.resultBytes)throw new NotificationExecutionError('notification_capacity');
 let recipients=0;
 return table.rows.map(row=>{
  if(typeof row.message!=='string'||!row.message.trim())throw new NotificationExecutionError('notification_output_invalid');
  if([...row.message].length>limits.messageCodePoints)throw new NotificationExecutionError('notification_capacity');
  const to=row.to===null?[]:Array.isArray(row.to)?row.to:[row.to];
  if(to.length>limits.recipientsPerRow)throw new NotificationExecutionError('notification_capacity');
  if(to.some(id=>id!==null&&(typeof id!=='string'||!/^usr_[a-z0-9]+$/.test(id))))throw new NotificationExecutionError('notification_output_invalid');
  const recipientIds=[...new Set(to.filter((id):id is string=>id!==null))];
  recipients+=recipientIds.length;if(recipients>limits.recipients)throw new NotificationExecutionError('notification_capacity');
  return {recipientIds,message:row.message};
 });
}

export async function evaluateNotificationQuery(input:MutationNotificationJobInput,dependencies:NotificationQueryDependencies={load:loadNotificationQuery}):Promise<MutationNotificationPlan>{
 const {flow,rules}=notificationQueryContext(input),context=await dependencies.load(input);
 const plans:MutationNotificationPlan['rules']=[];
 const started=performance.now();
 try{
  for(const rule of rules){
   const logical={...input.bindings.values,...platformValues(input.bindings)};
   const selected=selectQueries({...flow,queries:[...flow.queries,rule]},{only:[rule.name]});
   if(selected.some(query=>query.params.some(name=>!Object.hasOwn(logical,name))))throw new NotificationExecutionError('notification_bindings_invalid');
   const timeoutMs=Math.floor(NOTIFICATION_QUERY_LIMITS.timeoutMs-(performance.now()-started));
   if(timeoutMs<1)throw new NotificationExecutionError('notification_query_timeout');
   const {state}=await executeDocumentQueries({...flow,queries:[...flow.queries,rule]},context.resolve,{
    only:[rule.name],actor:context.actor,members:context.members,userId:input.bindings.userId,now:input.bindings.now,tz:input.bindings.tz,
    bindings:input.bindings,refresh:true,sourceFence:true,completeResults:true,limit:NOTIFICATION_QUERY_LIMITS.rows,
    resultBytes:NOTIFICATION_QUERY_LIMITS.resultBytes,timeoutMs,authorize:context.authorize,
   });
   const result=state.tables[rule.name];
   if(!result||Object.keys(state.errors).length)throw new NotificationExecutionError('notification_query_invalid');
   const sources=notificationRuleSourceIds(input,rule.name).map(id=>{
    const receipt=context.receipt(id);if(!receipt)throw new NotificationExecutionError('notification_access_revoked');return receipt;
   });
   plans.push({ruleName:rule.name,rows:normalizeNotificationResult(result),sources});
  }
 }catch(error){
  if(error instanceof DataflowResultError)throw new NotificationExecutionError(error.reason==='capacity'?'notification_capacity':error.reason==='timeout'?'notification_query_timeout':'notification_query_invalid');
  throw error;
 }
 return {executionFence:context.executionFence,rules:plans};
}
async function loadNotificationQuery(input:MutationNotificationJobInput){
 const db=await getDb();
 const initial=await db.transaction(async tx=>({
  executionFence:await notificationExecutionFence(tx,input),
  principal:await notificationPrincipal(tx,input.initiator.principal),
  document:await notificationArtifactAuthority(tx,input.origin.documentId),
 }));
 const receipts=new Map<string,NotificationSource>();
 const authorize=async()=>{
  const current=await db.transaction(tx=>notificationExecutionFence(tx,input));
  if(JSON.stringify(current)!==JSON.stringify(initial.executionFence))throw new NotificationExecutionError('notification_authority_changed',true);
 };
 return {executionFence:initial.executionFence,actor:initial.principal.actor,members:await acceptedMembers(input.origin.documentId),authorize,
  receipt:(id:string)=>receipts.get(id),
  resolve:async(id:string,mode?:DocumentQuerySourceMode)=>{
   const source=await db.transaction(tx=>notificationExecutionSource(tx,input,id));
   const prior=receipts.get(id);
   if(prior&&prior.schemaRevision!==source.receipt.schemaRevision)throw new NotificationExecutionError('notification_schema_changed');
   if(prior&&prior.authorityRevision!==source.receipt.authorityRevision)throw new NotificationExecutionError('notification_authority_changed',true);
   receipts.set(id,source.receipt);
   return tableForRef(source.row,initial.principal.actor,initial.document.row,mode===undefined||mode==='import');
  },
 };
}
