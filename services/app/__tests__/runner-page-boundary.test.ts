/** Current program runner: SQL capabilities remain host-owned and each run has isolated state. */
import {it,expect} from 'vitest';
import {useAppHarness} from './harness';
import {createSqliteSql} from '@artifactbin/sql/sqlite';
import {createRunner} from '@artifactbin/runner/local';
import type {RunnerJson} from '@artifactbin/contracts';
const harness=useAppHarness();
async function terminal(runner:Awaited<ReturnType<typeof createRunner>>,runId:string,userId='fixture-user'){
 for(let n=0;n<1200;n++){const run=await runner.getRun({userId,runId});if(run.receipt)return run;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('runner_not_terminal');
}
it('runs without DOM, reads real SQL, commits a mutation and observes refreshed rows',async()=>{
 const sql=createSqliteSql({maxRows:100,timeoutMs:2000});
 let rows=[{region:'west',amount:10},{region:'east',amount:20}];
 const columns=[{name:'region',type:'string' as const},{name:'amount',type:'number' as const}],calls:string[]=[];
 const runner=await createRunner({db:await harness.db(),dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async(context,operation,args)=>{
  expect(context.request.userId).toBe('fixture-user');const input=args as Record<string,string>;
  if(operation==='read'){
   calls.push('read:'+input.region);
   const result=(await sql.run({tables:{sales:{rows,columns}},queries:[{name:'monthly',sql:'SELECT SUM(amount) AS total FROM sales WHERE region=$region'}],params:input})).monthly!;
   if('error' in result)throw Error(result.error);return result as unknown as RunnerJson;
  }
  expect(operation).toBe('artifactbin.rename');
  const result=await sql.mutate({table:{name:'sales',rows,columns},sql:'UPDATE sales SET region=$to WHERE region=$from',params:input});
  if('error' in result)throw Error(result.error);rows=result.rows as typeof rows;calls.push('commit');return {committed:true};
 }});
 try{
  const {runId}=await runner.start({userId:'fixture-user',requestId:crypto.randomUUID(),input:null,program:{language:'typescript',source:`export default async function(input,c){
   const initial=await c.artifactbin.read({region:'west'});
   const east=await c.artifactbin.read({region:'east'});
   await c.artifactbin.call('rename',{from:'west',to:'east'});
   const updated=await c.artifactbin.read({region:'east'});
   return {initial,east,updated,dom:typeof document};
  }`}});
  const result=await terminal(runner,runId);expect(result.status,JSON.stringify(result)).toBe('completed');
  expect(result.output).toMatchObject({initial:{rows:[{total:10}]},east:{rows:[{total:20}]},updated:{rows:[{total:30}]},dom:'undefined'});
  expect(calls).toEqual(['read:west','read:east','commit','read:east']);
 }finally{await runner.close();}
},15000);
it('rejects retired page bindings before admission',async()=>{
 const runner=await createRunner({db:await harness.db(),capabilities:async()=>null});
 try{await expect(runner.start({userId:'fixture-user',requestId:crypto.randomUUID(),input:null,program:{language:'typescript',source:"import { absent } from 'page'; export default () => absent.value"}})).rejects.toThrow('import_not_allowed');}finally{await runner.close();}
});
it('propagates host read and mutation failures through capability promises',async()=>{
 const runner=await createRunner({db:await harness.db(),dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async()=>{throw Error('denied_fixture');}});
 try{
  const {runId}=await runner.start({userId:'fixture-user',requestId:crypto.randomUUID(),input:null,program:{language:'typescript',source:`export default async function(input,c){let readError,writeError;try{await c.artifactbin.read({});}catch(e){readError=e.message;}try{await c.artifactbin.call('rename',{});}catch(e){writeError=e.message;}return {readError,writeError};}`}});
  const result=await terminal(runner,runId);expect(result.status).toBe('completed');expect(result.output).toEqual({readError:'denied_fixture',writeError:'denied_fixture'});
 }finally{await runner.close();}
},15000);
it('isolates program state and authenticated SQL responses across concurrent runs',async()=>{
 const runner=await createRunner({db:await harness.db(),dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async(context,_operation,args)=>{
  const {region}=args as {region:string};if(region==='east')await new Promise(resolve=>setTimeout(resolve,25));return {rows:[{region,user:context.request.userId}]};
 }});
 try{
  const starts=await Promise.all(['east','north'].map(region=>runner.start({userId:region,requestId:crypto.randomUUID(),input:{region},program:{language:'typescript',source:`let region;export default async function(input,c){region=input.region;const rows=await c.artifactbin.read({region});return {region,rows};}`}})));
  for(const [i,region] of ['east','north'].entries()){
   const result=await terminal(runner,starts[i]!.runId,region);expect(result.status).toBe('completed');expect(result.output).toEqual({region,rows:{rows:[{region,user:region}]}});
  }
 }finally{await runner.close();}
},15000);
