import {afterEach,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {RESOLVER_LIMITS,type RunnerJson,type Upstream} from '@artifactbin/contracts';
import {createRunner} from '../src/local';
import {remoteArtifactbin} from '../src/capabilities';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const MiB=1024*1024;
describe('the resolver limits table',()=>{
 it('moves together: each link after the fetch response is at least as large, and the app outwaits the wall time',()=>{
  // caps.query's document and answer caps join the table (resolvers plan PR 5: 16 KiB document, 1 MiB result).
  expect(RESOLVER_LIMITS).toEqual({fetchResponseBytes:2*MiB,fetchRequestBodyBytes:256*1024,fetchTimeoutMs:10_000,messageBytes:4*MiB,outputBytes:MiB,wallMs:15_000,appWaitMs:16_000,maxRequests:32,queryDocumentBytes:16*1024,queryResultBytes:MiB,runWaitMs:20_000});
  // One completion wait covers the app's whole wait, and returns before the runner client's 30 s request timeout.
  expect(RESOLVER_LIMITS.runWaitMs).toBeGreaterThanOrEqual(RESOLVER_LIMITS.appWaitMs);expect(RESOLVER_LIMITS.runWaitMs).toBeLessThan(30_000);
  expect(RESOLVER_LIMITS.messageBytes).toBeGreaterThanOrEqual(RESOLVER_LIMITS.queryResultBytes);
  expect(RESOLVER_LIMITS.messageBytes).toBeGreaterThanOrEqual(2*RESOLVER_LIMITS.fetchResponseBytes);
  expect(RESOLVER_LIMITS.appWaitMs).toBe(RESOLVER_LIMITS.wallMs+1000);
  expect(RESOLVER_LIMITS.fetchTimeoutMs).toBeLessThan(RESOLVER_LIMITS.wallMs);
 });
});
describe('controller links',()=>{
 async function run(n:number){
  const db=new PGlite();cleanup.push(()=>db.close());
  const runner=await createRunner({db,dockerImage:process.env.RUNNER_TEST_IMAGE,capabilities:async(_ctx,operation,args)=>{
   if(operation!=='artifactbin.pageBackend.fetch')throw Error('forbidden');
   return {status:200,url:'https://api.example.com/',headers:{},body:'x'.repeat(Number((args as {n:number}).n)),receipt:{method:'GET',host:'api.example.com',path:'/v1',bytesIn:Number((args as {n:number}).n),bytesOut:0,secrets:['KEY']}};
  }});cleanup.push(()=>runner.close());
  const {runId}=await runner.start({userId:'alice',requestId:'r',program:{language:'javascript',source:'export default async(i,c)=>{const r=await c.artifactbin.call("pageBackend.fetch",{n:i.n}).catch(e=>({error:e.message}));return {length:r.body?.length??null,receipt:"receipt" in r,error:r.error??null};}'},input:{n}});
  for(let i=0;i<1500;i++){const s=await runner.getRun({userId:'alice',runId});if(s.receipt)return s;await new Promise(r=>setTimeout(r,10));}
  throw Error('never terminated');
 }
 it('carries a 3 MiB capability reply to the worker and records the fetch receipt outside it',async()=>{
  const s=await run(3*MiB);
  expect(s.output).toEqual({length:3*MiB,receipt:false,error:null});
  expect(s.receipt?.requests).toContainEqual(expect.objectContaining({service:'fetch',operation:'artifactbin.pageBackend.fetch',status:200,fetch:{method:'GET',host:'api.example.com',path:'/v1',bytesIn:3*MiB,bytesOut:0,secrets:['KEY']}}));
 },20000);
 it('refuses a reply past the 4 MiB message cap',async()=>{
  expect((await run(RESOLVER_LIMITS.messageBytes)).output).toEqual({length:null,receipt:false,error:'size_limit'});
 },20000);
});
describe('remote capability callback',()=>{
 const context={runId:'run1',callId:1,request:{requestId:'q',userId:'owner1',program:{source:'',language:'javascript' as const},input:null},signal:new AbortController().signal,requests:[],usage:[]};
 const reply=(body:string,status=200):Upstream=>async()=>new Response(body,{status,headers:{'content-type':'application/json'}});
 const call=(upstream:Upstream)=>remoteArtifactbin('https://app.internal',upstream)(context,'artifactbin.pageBackend.fetch',{url:'https://api.example.com/'} as RunnerJson);
 it('accepts replies up to 4 MiB and refuses larger ones',async()=>{
  expect(await call(reply(JSON.stringify({body:'x'.repeat(3*MiB)})))).toEqual({body:'x'.repeat(3*MiB)});
  await expect(call(reply(JSON.stringify({body:'x'.repeat(RESOLVER_LIMITS.messageBytes)})))).rejects.toThrow('response_limit');
 });
 it('passes a refusal code through, as the in-process host does, and nothing else',async()=>{
  await expect(call(reply(JSON.stringify({error:'secret_host_forbidden'}),400))).rejects.toThrow(/^secret_host_forbidden$/);
  await expect(call(reply(JSON.stringify({error:'Bearer sk-live leaked'}),400))).rejects.toThrow(/^artifactbin_http_400$/);
  await expect(call(reply('not json',502))).rejects.toThrow(/^artifactbin_http_502$/);
 });
 it('refuses operations outside the app capability surface',async()=>{
  await expect(remoteArtifactbin('https://app.internal',reply('{}'))(context,'shell',{})).rejects.toThrow('operation_not_allowed');
 });
});
