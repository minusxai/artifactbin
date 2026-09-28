/** Retained, versioned compiled context. JSONB key ordering must not change its identity. */
import {createHash} from 'node:crypto';
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
import type {CompiledDataflow,CompiledNotify} from './story/compiled-dataflow';
import {parseCompiledDataflow} from './story/parsed-artifact-metadata';
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
export function notificationQueryContext(input:MutationNotificationJobInput):{flow:CompiledDataflow;rule:CompiledNotify}{
 const snapshot=input.contextSnapshot;
 if(!snapshot||snapshot.version!==1||Object.keys(snapshot).sort().join(',')!=='flow,version'||notificationRevision(snapshot)!==input.contextRevision)throw new NotificationExecutionError('notification_context_invalid');
 const flow=parseCompiledDataflow(snapshot.flow),rule=flow?.notifications?.find(item=>item.name===input.origin.ruleId);
 if(!flow||!rule||rule.name!==input.rule.name||rule.on!==input.rule.on||rule.on!==input.origin.mutationName||rule.sql!==input.rule.sql)throw new NotificationExecutionError('notification_context_invalid');
 return {flow,rule};
}
