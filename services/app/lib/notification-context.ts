/** Retained, versioned compiled context. JSONB key ordering must not change its identity. */
import {createHash} from 'node:crypto';
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
import type {CompiledDataflow,CompiledNotify} from './story/compiled-dataflow';
import {parseCompiledDataflow} from './story/parsed-artifact-metadata';
import {selectQueries,importRef} from './story/compiled-flow';
import {NotificationExecutionError} from './notification-error';
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
 return value;
}
export const notificationRevision=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function notificationContextSnapshot(flow:CompiledDataflow):Pick<MutationNotificationJobInput,'contextSnapshot'|'contextRevision'>{
 const contextSnapshot=JSON.parse(JSON.stringify({version:1,flow})) as Record<string,unknown>;
 if(!parseCompiledDataflow(contextSnapshot.flow))throw new NotificationExecutionError('notification_context_invalid');
 return {contextSnapshot,contextRevision:notificationRevision(contextSnapshot)};
}
export function notificationQueryContext(input:MutationNotificationJobInput):{flow:CompiledDataflow;rules:CompiledNotify[]}{
 const snapshot=input.contextSnapshot;
 if(!snapshot||snapshot.version!==1||Object.keys(snapshot).sort().join(',')!=='flow,version'||notificationRevision(snapshot)!==input.contextRevision)throw new NotificationExecutionError('notification_context_invalid');
 const flow=parseCompiledDataflow(snapshot.flow);
 const rules=flow?.notifications?.filter(rule=>rule.on===input.origin.mutationName);
 if(!flow||!rules?.length||rules.length!==input.rules.length||rules.some((rule,index)=>{
   const saved=input.rules[index];return !saved||rule.name!==saved.name||rule.on!==saved.on||rule.sql!==saved.sql||rule.source!==saved.source;
 }))throw new NotificationExecutionError('notification_context_invalid');
 return {flow,rules};
}
export function notificationRuleSourceIds(input:MutationNotificationJobInput,ruleName:string):string[]{
 const {flow,rules}=notificationQueryContext(input),rule=rules.find(rule=>rule.name===ruleName);
 if(!rule)throw new NotificationExecutionError('notification_context_invalid');
 const queries=selectQueries({...flow,queries:[...flow.queries,rule]},{only:[rule.name]});
 return [...new Set(queries.flatMap(query=>[...query.reads.imports.map(name=>importRef(flow,name)!),...(query.source?[query.source]:[])]))].sort();
}
