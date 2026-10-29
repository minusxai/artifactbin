/**
 * The frozen compilation context a notification job carries: its identity ignores JSON key order,
 * and a job whose saved rules no longer match its snapshot is refused rather than evaluated.
 * Pure: no database.
 */
import {expect,it} from 'vitest';
import type {MutationNotificationJobInput} from '@artifactbin/contracts';
import type {CompiledDataflow,CompiledNotify} from '@/lib/dataflow';
import {NotificationExecutionError,notificationContextSnapshot,notificationQueryContext,notificationRuleSourceIds} from '@/lib/notifications';

const rule=(name:string,sql:string,imports:string[]):CompiledNotify=>({name,on:'change',engine:'sqlite',sql,params:[],reads:{imports,queries:[],values:[],builtins:[]},columns:[{name:'to',type:null},{name:'message',type:'string'}],start:0,end:0});
const flow:CompiledDataflow={
 imports:[{name:'tasks',ref:'ds_tasks',tables:[{name:'rows',columns:[{name:'n',type:'number'}]}]},{name:'people',ref:'ds_people',tables:[{name:'rows',columns:[{name:'id',type:'string'}]}]}],
 values:[],queries:[],mutations:[],
 notifications:[rule('both','select null as "to", \'x\' as message from tasks.rows, people.rows',['tasks','people']),rule('none','select null as "to", \'y\' as message',[])],
};
function job(snapshot=notificationContextSnapshot(flow)):MutationNotificationJobInput{
 return {origin:{mutationRunId:'run',documentId:'doc',documentEditId:'edit',documentVersion:1,mutationName:'change'},initiator:{principal:{kind:'user',id:'alice'},execution:'human',agentLabel:null},
  rules:flow.notifications!.map(({name,on,sql})=>({name,on,sql})),bindings:{values:{},types:{},userId:'alice',now:'2026-01-01T00:00:00Z',tz:'UTC'},...snapshot};
}

it('derives one revision for the same context whatever its key order',()=>{
 const reordered=JSON.parse(JSON.stringify(flow,Object.keys(flow).toReversed())) as CompiledDataflow;
 const a=notificationContextSnapshot(flow),b=notificationContextSnapshot({...reordered,...flow});
 expect(a.contextRevision).toMatch(/^[0-9a-f]{64}$/);
 expect(b.contextRevision).toBe(a.contextRevision);
 expect(notificationContextSnapshot({...flow,notifications:flow.notifications!.slice(0,1)}).contextRevision).not.toBe(a.contextRevision);
 expect(a.contextSnapshot).toEqual({version:1,flow:JSON.parse(JSON.stringify(flow))});
});

it('names every dataset a rule reads, sorted and once each',()=>{
 expect(notificationRuleSourceIds(job(),'both')).toEqual(['ds_people','ds_tasks']);
 expect(notificationRuleSourceIds(job(),'none')).toEqual([]);
});

it('refuses a job whose snapshot, revision or saved rules no longer agree',()=>{
 const good=job();
 const refused=(input:MutationNotificationJobInput,name='both')=>expect(()=>notificationRuleSourceIds(input,name)).toThrow(expect.objectContaining({code:'notification_context_invalid'}));
 refused(good,'missing');
 refused({...good,contextRevision:'0'.repeat(64)});
 refused({...good,contextSnapshot:{...good.contextSnapshot,extra:true}});
 refused({...good,contextSnapshot:{...good.contextSnapshot,version:2}});
 refused({...good,rules:good.rules.slice(0,1)});
 refused({...good,rules:good.rules.map(r=>({...r,sql:r.sql+' '}))});
 refused({...good,origin:{...good.origin,mutationName:'other'}});
});

it('answers a job\'s flow and rules, and refuses a snapshot that is not the one its revision names',()=>{
 const input=job();
 expect(notificationQueryContext(input)).toEqual({flow:expect.objectContaining({imports:flow.imports}),rules:flow.notifications});
 for(const broken of [
  {...input,contextRevision:'0'.repeat(64)},
  {...input,contextSnapshot:{...input.contextSnapshot,extra:true}},
  {...input,rules:input.rules.slice(0,1)},
  {...input,rules:input.rules.map(rule=>({...rule,sql:'select 1'}))},
  {...input,origin:{...input.origin,mutationName:'other'}},
 ]){
  const thrown=(()=>{try{notificationQueryContext(broken as MutationNotificationJobInput);}catch(error){return error;}})();
  expect(thrown).toBeInstanceOf(NotificationExecutionError);
  expect(thrown).toMatchObject({code:'notification_context_invalid',retryable:false,name:'NotificationExecutionError'});
 }
});
