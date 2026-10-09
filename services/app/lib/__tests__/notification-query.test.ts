import {expect,it} from 'vitest';
import type {MutationNotificationJobInput,TableResult} from '@artifactbin/contracts';
import {evaluateNotificationQuery,normalizeNotificationResult,type NotificationQueryDependencies} from '@/lib/notifications';
import {notificationContextSnapshot,notificationRuleSourceIds} from '@/lib/notifications';
import {readerDataflow,type CompiledDataflow} from '@/lib/dataflow/compiled-dataflow';
const rule={name:'first',on:'save',engine:'sqlite' as const,sql:'select $recipient as "to", $_now || $_tz as message',params:['recipient','_now','_tz'],reads:{imports:[],queries:[],values:[],builtins:['_now' as const,'_tz' as const]},columns:[{name:'to',type:'user' as const},{name:'message',type:'string' as const}],start:0,end:1};
const flow:CompiledDataflow={imports:[],values:[],queries:[],mutations:[],notifications:[rule]};
const input=(compiled=flow):MutationNotificationJobInput=>({origin:{mutationRunId:'run',mutationName:'save',documentId:'Doc001',documentEditId:'edit',documentVersion:1},initiator:{principal:{kind:'user',id:'usr_actor'},execution:'human',agentLabel:null},rules:compiled.notifications!.map(({name,on,sql,source})=>({name,on,sql,...(source?{source}:{})})),bindings:{values:{recipient:'usr_recipient'},types:{recipient:'user'},userId:'usr_actor',now:'2026-01-01T00:00:00.000Z',tz:'Asia/Kolkata'},...notificationContextSnapshot(compiled)});
const dependencies:NotificationQueryDependencies={load:async()=>({executionFence:{principalRevision:'p',documentRevision:'d',contextRevision:'c'},actor:{userId:'usr_actor',tokenId:null},members:[],resolve:async()=>null,receipt:()=>undefined,authorize:async()=>{}})};
const table=(to:unknown):TableResult=>({columns:[{name:'to',type:'string'},{name:'message',type:'string'}],rows:[{to,message:'changed'}]});
it('accepts a typed list and nullable recipients but refuses a JSON string pretending to be a list',()=>{
 expect(normalizeNotificationResult(table(['usr_a',null,'usr_a','usr_b']))).toEqual([{recipientIds:['usr_a','usr_b'],message:'changed'}]);
 expect(normalizeNotificationResult(table(null))).toEqual([{recipientIds:[],message:'changed'}]);
 expect(()=>normalizeNotificationResult(table('["usr_a"]'))).toThrow('notification_output_invalid');
});
it('evaluates all rules with frozen platform values',async()=>{
 const compiled={...flow,notifications:[rule,{...rule,name:'second',sql:'select $recipient as "to", \'second\' as message',params:['recipient']}]};
 const plan=await evaluateNotificationQuery(input(compiled),dependencies);
 expect(plan.rules.map(rule=>rule.rows[0]?.message)).toEqual(['2026-01-01T00:00:00.000ZAsia/Kolkata','second']);
});
it('refuses absent saved inputs instead of silently binding NULL',async()=>{
 const job=input();job.bindings.values={};
 await expect(evaluateNotificationQuery(job,dependencies)).rejects.toThrow('notification_bindings_invalid');
});
it('a later rule failure returns no partial plan',async()=>{
 const compiled={...flow,notifications:[rule,{...rule,name:'second',sql:'select * from missing_table'}]};
 await expect(evaluateNotificationQuery(input(compiled),dependencies)).rejects.toThrow('notification_query_invalid');
});
it('returns transitive and filter-only source IDs and excludes notifications from the reader plan',()=>{
 const {on:_on,...query}=rule;
 const upstream={...query,name:'filter',reads:{...rule.reads,imports:['private_data']},source:'Connected1'};
 const compiled={...flow,imports:[{name:'private_data',ref:'Private001',tables:[]}],queries:[upstream],notifications:[{...rule,reads:{...rule.reads,queries:['filter']}}]};
 expect(notificationRuleSourceIds(input(compiled),'first')).toEqual(['Connected1','Private001']);
 expect(readerDataflow(compiled).notifications).toBeUndefined();
});
it('rejects truncated output and oversized messages',()=>{
 expect(()=>normalizeNotificationResult({...table('usr_a'),truncated:true})).toThrow('notification_capacity');
 expect(()=>normalizeNotificationResult({...table('usr_a'),rows:[{to:'usr_a',message:'x'.repeat(501)}]})).toThrow('notification_capacity');
});
