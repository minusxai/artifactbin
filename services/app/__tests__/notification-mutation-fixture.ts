/** Retained commit-engine proof, independent of the retired markup authoring DSL.
 * Native resolver notification declarations are not an author-facing capability. */
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
import {identityForUser} from '@/lib/accounts';
import {durableMutation,getArtifactById} from '@/lib/artifacts';
import {mutateDataset,isMutationRefused,adaptMutationOperationReply,mutationInitiator} from '@/lib/document-data';
import {notificationContextSnapshot} from '@/lib/notifications';
import type {CompiledDataflow,CompiledNotify} from '@/lib/dataflow';

export function notificationMutationFixture(token:{id:string;userId:string|null},doc:{id:string;edit_id:string;version:number},dataset:{id:string},sql:string,rules:readonly {name:string;sql:string}[]){
 const actor=identityForUser(token.userId,token.id),initiator=mutationInitiator(actor,'agent');
 const flow:CompiledDataflow={imports:[{name:'tasks',ref:dataset.id,tables:[{name:'rows',columns:[{name:'n',type:'number'}]}]}],values:[],queries:[],mutations:[],notifications:rules.map(rule=>({name:rule.name,on:'increment',engine:'sqlite',sql:rule.sql,params:[],reads:{imports:rule.sql.includes('tasks.rows')?['tasks']:[],queries:[],values:[],builtins:[]},columns:[{name:'to',type:null},{name:'message',type:'string'}],start:0,end:0} satisfies CompiledNotify))};
 const snapshot=notificationContextSnapshot(flow);
 return async(key:string,route:'api'|'browser'='api')=>{
  const reply=await durableMutation(actor,'http://localhost:3000',key,{documentId:doc.id,mutation:'increment',args:{amount:1}},async receipt=>{
   const job:MutationNotificationJobInput={origin:{mutationRunId:receipt.runId!,documentId:doc.id,documentEditId:doc.edit_id,documentVersion:doc.version,mutationName:'increment'},initiator,rules:rules.map(rule=>({...rule,on:'increment'})),bindings:{values:{amount:1},types:{amount:'number'},userId:token.userId,now:'2026-01-01T00:00:00Z',tz:'UTC'},...snapshot};
   const result=await mutateDataset((await getArtifactById(dataset.id))!,actor,sql,{amount:1},{target:{schema:'tasks',table:'rows'},paramTypes:{amount:'number'},document:{id:doc.id,editId:doc.edit_id},receipt,notificationJob:job});
   if(isMutationRefused(result))return {status:result.reason==='policy_denied'?403:400,body:{error:result.reason}};
   return {status:200,body:{id:result.row.id,version:result.row.version,affected:result.affected,rowCount:result.rowCount,mutationRunId:result.mutationRunId}};
  },{initiator});
  const result=adaptMutationOperationReply(reply,route);return Response.json(result.body,{status:result.status});
 };
}
