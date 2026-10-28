import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {runCli} from '../src/dispatch';
import {parseCommand,commandHelp} from '../src/commands';
import {cliHarness} from './harness';

test('schedule commands use the authenticated HTTP API through real CLI dispatch',async()=>{
 const calls:{method:string;path:string;body:unknown}[]=[];
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-token');
  let raw='';for await(const chunk of req)raw+=chunk;
  calls.push({method:req.method!,path:req.url!,body:raw?JSON.parse(raw):undefined});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const h=await cliHarness('afbin-schedules-http-',{server:origin});
 try{
  for(const [args,method,path,body] of [
   [['create','--artifact','abc123','--cron','0 9 * * *','--timezone','Asia/Kolkata','--input','{"region":"east"}','--max-attempts','3','--retry-backoff','60'],'POST','/api/schedules',{artifactId:'abc123',cron:'0 9 * * *',timezone:'Asia/Kolkata',input:{region:'east'},maxAttempts:3,retryBackoffSeconds:60}],
   [['list'],'GET','/api/schedules',undefined],
   [['get','sch_123'],'GET','/api/schedules/sch_123',undefined],
   [['update','sch_123','--cron','0 10 * * *','--input','null'],'PATCH','/api/schedules/sch_123',{cron:'0 10 * * *',input:null}],
   [['pause','sch_123'],'PATCH','/api/schedules/sch_123',{enabled:false}],
   [['resume','sch_123'],'PATCH','/api/schedules/sch_123',{enabled:true}],
   [['history','sch_123'],'GET','/api/schedules/sch_123/history',undefined],
   [['delete','sch_123'],'DELETE','/api/schedules/sch_123',undefined],
  ] as const){
   const out:string[]=[];
   assert.equal(await runCli(['schedule',...args,'--server',origin,'--json'],{cwd:h.root,home:h.home,env:{},interactive:false,stdout:value=>out.push(value),stderr:()=>{}}),0,args.join(' '));
   assert.deepEqual(calls.at(-1),{method,path,body});assert.equal(JSON.parse(out.at(-1)!).ok,true);
  }
 }finally{await h.cleanup();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
test('invalid_schedule HTTP refusal keeps its code and explains how to correct the request',async()=>{
 const server=createServer(async(req,res)=>{
  assert.equal(req.method,'POST');assert.equal(req.url,'/api/schedules');assert.equal(req.headers.authorization,'Bearer test-token');
  let raw='';for await(const chunk of req)raw+=chunk;
  assert.deepEqual(JSON.parse(raw),{artifactId:'abc123',cron:'nonsense',timezone:'Bad/Zone'});
  res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'invalid_schedule'}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const h=await cliHarness('afbin-schedule-invalid-http-',{server:origin});
 try{
  const out:string[]=[],err:string[]=[];
  const code=await runCli(['schedule','create','--artifact','abc123','--cron','nonsense','--timezone','Bad/Zone','--server',origin,'--json'],{cwd:h.root,home:h.home,env:{},interactive:false,stdout:value=>out.push(value),stderr:value=>err.push(value)});
  assert.equal(code,1);const answer=JSON.parse(out.at(-1)!);
  assert.equal(answer.error.code,'invalid_schedule');assert.equal(answer.error.details.error,'invalid_schedule');assert.equal(answer.error.details.http_status,400);
  assert.match(answer.error.message,/five cron fields.*IANA timezone.*retry backoff/i);assert.match(answer.error.fix,/five cron fields.*IANA timezone/i);
  assert.match(err.join(''),/five cron fields/i);assert.doesNotMatch(err.join(''),/invalid_schedule: invalid_schedule/);
 }finally{await h.cleanup();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
test('manual schedule run recovers the journalled request after an uncertain response',async()=>{
 const h=await cliHarness('afbin-schedule-recovery-');
 try{
  let requestId:string|undefined;let key:string|undefined;let calls=0;
  const respond=(call:import('./harness').RecordedCall)=>{
   assert.equal(call.path,'/api/schedules/sch_123/run');assert.equal(call.method,'POST');
   const body=call.body as {requestId:string};assert.ok(body.requestId);
   if(!requestId){requestId=body.requestId;key=call.key;}else{assert.equal(body.requestId,requestId);assert.equal(call.key,key);}
   if(++calls===1)throw new Error('lost reply');return Response.json({occurrenceId:'occ_1'});
  };
  assert.notEqual(await h.invoke(['schedule','run','sch_123','--json'],respond),0);
  assert.notEqual(await h.invoke(['schedule','run','sch_other','--json'],respond),0);
  assert.equal(calls,1,'a different run must not replace the pending request');
  assert.equal(await h.invoke(['schedule','run','sch_123','--json'],respond),0);
  assert.equal(h.last().occurrenceId,'occ_1');assert.ok(h.last().operation);
 }finally{await h.cleanup();}
});
test('schedule parsing rejects malformed and irrelevant arguments before authentication',()=>{
 for(const args of [['create'],['create','--artifact','abc123','--cron','* * * * *'],['list','sch_1'],['get','../bad'],['pause','sch_1','--cron','* * * * *'],['update','sch_1'],['update','sch_1','--max-attempts','0'],['run','sch_1','--request',''],['create','--artifact','abc123@2','--cron','* * * * *','--timezone','UTC'],['update','sch_1','--input','oops']])assert.throws(()=>parseCommand(['schedule',...args]),args.join(' '));
 assert.match(commandHelp('schedule'),/live artifact/);
});

test('manual schedule run carries a caller request identity',async()=>{
 const h=await cliHarness('afbin-schedule-request-');
 try{
  assert.equal(await h.invoke(['schedule','run','sch_123','--request','caller-1','--json'],call=>{
   assert.deepEqual(call.body,{requestId:'caller-1'});assert.ok(call.key);
   return Response.json({occurrenceId:'occ_1'});
  }),0);
 }finally{await h.cleanup();}
});
