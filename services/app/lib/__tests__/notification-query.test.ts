import {describe,it,expect} from 'vitest';
import type {MutationNotificationJobInput,TableResult} from '@artifactbin/contracts';
import {evaluateNotificationQuery,type NotificationQueryContext} from '../notification-query';
import {runQueries} from '../sql/engine';
const input:MutationNotificationJobInput={origin:{mutationRunId:'run',documentId:'doc123',documentEditId:'edit',documentVersion:1,mutationName:'change',ruleId:'notice'},initiator:{principal:{kind:'user',id:'usr_one'},execution:'human',agentLabel:null},rule:{name:'notice',on:'change',sql:''},bindings:{values:{task:'one'},types:{task:'string'},userId:'usr_one',now:'2026-09-01T00:00:00.000Z',tz:'Asia/Kolkata'},contextRevision:'context',contextSnapshot:{}};
const context=(sql:string):NotificationQueryContext=>({flow:{imports:[],values:[],queries:[],mutations:[]},rule:{name:'notice',on:'change',sql,engine:'sqlite',params:['task','_me.id','_now','_tz'],parameterTypes:{task:'string'},reads:{imports:[],queries:[],values:['task'],builtins:['_me.id','_now','_tz']},relations:[],start:0,end:0},imports:{},executionFence:{principalRevision:'principal',documentRevision:'doc',contextRevision:'context'},sources:[]});
const evaluate=(sql:string,table?:TableResult)=>evaluateNotificationQuery(input,{load:async()=>context(sql),run:table?async()=>({notice:table}):runQueries});
describe('notification query evaluation',()=>{
 it('binds the saved logical run values, user, time and timezone through the real read adapter',async()=>{
  const plan=await evaluate(`select $_me__id as "to", $task || ' ' || $_now || ' ' || $_tz as message`);
  expect(plan.rows).toEqual([{recipientIds:['usr_one'],message:'one 2026-09-01T00:00:00.000Z Asia/Kolkata'}]);
  expect(plan.executionFence).toEqual(context('').executionFence);
 });
 it('reads current source data, keeps predicate-only provenance, and returns empty after deletion',async()=>{
  const ctx=context(`select assignee as "to", title as message from tasks.rows where exists(select 1 from allowed.rows)`);
  ctx.rule.reads.imports=['tasks','allowed'];ctx.rule.relations=[{schema:'tasks',table:'rows'},{schema:'allowed',table:'rows'}];
  ctx.sources=[{artifactId:'tasks1',schema:'public',table:'rows',schemaRevision:'s',authorityRevision:'a'},{artifactId:'allow1',schema:'public',table:'rows',schemaRevision:'s',authorityRevision:'a'}];
  ctx.imports={tasks:{rows:{rows:[{assignee:'usr_two',title:'latest'}],columns:[{name:'assignee',type:'user'},{name:'title',type:'string'}]}},allowed:{rows:{rows:[{ok:1}],columns:[{name:'ok',type:'number'}]}}};
  const deps={load:async()=>ctx,run:runQueries};
  expect(await evaluateNotificationQuery(input,deps)).toMatchObject({sources:ctx.sources,rows:[{recipientIds:['usr_two'],message:'latest'}]});
  ctx.imports.tasks!.rows!.rows=[];
  expect((await evaluateNotificationQuery(input,deps)).rows).toEqual([]);
 });
 it('refuses writes through the real read adapter',async()=>{await expect(evaluate('create table stolen(x)')).rejects.toMatchObject({code:'notification_query_invalid'});});
 it('refuses truncated output instead of accepting a partial plan',async()=>{await expect(evaluate('',{columns:[{name:'to',type:'user'},{name:'message',type:'string'}],rows:[{to:'usr_one',message:'a'}],truncated:true})).rejects.toMatchObject({code:'notification_capacity'});});
 it.each([{to:7,message:'hi'},{to:'usr_one',message:null},{to:'usr_one',message:' '},{to:'["usr_one"]',message:'hi'},{to:['usr_one',4],message:'hi'}])('fails whole malformed result %#',async row=>{await expect(evaluate('',{columns:[{name:'to',type:'user'},{name:'message',type:'string'}],rows:[{to:'usr_two',message:'valid'},row]})).rejects.toMatchObject({code:'notification_output_invalid'});});
 it('skips null recipients and deduplicates only within each output row',async()=>{
  expect((await evaluate('',{columns:[{name:'to',type:'user'},{name:'message',type:'string'}],rows:[{to:null,message:'skip'},{to:['usr_one',null,'usr_one'],message:'same'},{to:'usr_one',message:'same'}]})).rows).toEqual([{recipientIds:[],message:'skip'},{recipientIds:['usr_one'],message:'same'},{recipientIds:['usr_one'],message:'same'}]);
 });
 it('rejects output beyond row, message and recipient bounds',async()=>{
  for(const rows of [Array.from({length:1001},()=>({to:'usr_one',message:'ok'})),[{to:'usr_one',message:'a'.repeat(501)}],[{to:Array.from({length:21},(_,i)=>`usr_${i}`),message:'ok'}]])await expect(evaluate('',{columns:[{name:'to',type:'user'},{name:'message',type:'string'}],rows})).rejects.toMatchObject({code:'notification_capacity'});
 });

 it('rejects oversized intermediate dependencies instead of materializing their unbounded whole result',async()=>{
  const ctx=context(`select 'usr_one' as "to", cast(count(*) as text) as message from expanded`);
  ctx.rule.reads.queries=['expanded'];
  ctx.flow.queries=[{name:'expanded',sql:'WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM counter WHERE n<1002) SELECT n FROM counter',engine:'sqlite',params:[],reads:{imports:[],queries:[],values:[],builtins:[]},columns:[{name:'n',type:'number'}],start:0,end:0}];
  await expect(evaluateNotificationQuery(input,{load:async()=>ctx,run:runQueries})).rejects.toMatchObject({code:'notification_capacity'});
 });

 it('evaluates the maximum 1000-row / 500-code-point plan with the real adapter',async()=>{
  const started=performance.now(),before=process.memoryUsage().heapUsed;
  const plan=await evaluate(`WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM counter WHERE n<1000) SELECT 'usr_one' as "to", printf('%0500d',n) as message FROM counter`);
  expect(plan.rows).toHaveLength(1000);expect(plan.rows.every(row=>row.message.length===500)).toBe(true);
  console.info('notification-query-capacity',JSON.stringify({rows:plan.rows.length,bytes:Buffer.byteLength(JSON.stringify(plan.rows)),durationMs:Math.round(performance.now()-started),heapDeltaBytes:process.memoryUsage().heapUsed-before}));
 });
});
