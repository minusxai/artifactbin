import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error Existing root fixture is JavaScript without declarations.
import {testDatabase} from '../../../test/postgres.js';
// @ts-expect-error Existing pg dependency has no local type package.
import pg from 'pg';
import {createStore,createRemote,createApp} from '../graphql/store.ts';
import {IsolateHost} from '../isolates/host.ts';
import {createConnectorHost} from '../connectors/host.mjs';
import type {Request as CapabilityRequest} from '../connectors/contracts.ts';
import {FileServer} from '../replication/durable.ts';
import {createReplica,enqueue,markDispatched,reconcile,optimistic} from '../replication/model.ts';
import type {Operation,Server} from '../replication/contracts.ts';

const localSDL='type Query { count: Int! } type Mutation { setCount(value:Int!):Int! }';
const local=()=>createStore({sdl:localSDL,version:1,initial:{count:0},queries:{count:s=>s.count},mutations:{setCount:(s,a)=>s.count=a.value}});

test('real GraphQL → versioned workerd → host capability → PostgreSQL; post-commit failure remains unknown',async()=>{
 const db=await testDatabase();
 const pool=new pg.Pool({connectionString:db.connectionString,options:`-c search_path=${db.schema},public`,max:2,connectionTimeoutMillis:500});
 const connector=createConnectorHost({db:{kind:'postgres',pool,operations:{
  set:{text:'INSERT INTO counts(tenant,value) VALUES($1,$2) ON CONFLICT(tenant) DO UPDATE SET value=EXCLUDED.value RETURNING value',params:(p,i)=>[p.tenantId,(i as {value:number}).value]},
  read:{text:'SELECT value FROM counts WHERE tenant=$1',params:p=>[p.tenantId]},
 }}},{timeoutMs:1000});
 const principal={tenant:'a',subject:'alice'};
 const isolate=new IsolateHost({deadlineMs:2500,inputBytes:65536,outputBytes:65536,rssKillMiB:512},(p,request,signal)=>connector.invoke({userId:p.subject,tenantId:p.tenant,grants:['db']},request as unknown as CapabilityRequest,signal));
 const source=`export const typeDefs='type Query { read: Int! } type Mutation { set(value:Int!):Int! failAfterWrite(value:Int!):Int! }';
 export const schema={read:'Int',set:'Int',failAfterWrite:'Int'};
 export async function resolve(field,args,ctx,caps){
  const rows=await caps.invoke({resource:'db',operation:field==='read'?'read':'set',input:field==='read'?{}:{value:args.value,tenantId:'b',userId:'forged'}});
  if(field==='failAfterWrite')throw Error('lost response after durable commit');
  return rows[0]?.value??0;
 }`;
 const store=local();
 try {
  await db.pool.query('CREATE TABLE counts(tenant text PRIMARY KEY,value integer NOT NULL)');
  await isolate.deploy(principal,'v1',source);
  const remote=createRemote({sdl:isolate.schemaOf(principal,'v1'),online:()=>true,resolvers:Object.fromEntries(['read','set','failAfterWrite'].map(field=>[field,(args:Record<string,unknown>,signal:AbortSignal)=>isolate.invoke(principal,{version:'v1',field,args:args as any},signal)]))});
  const app=createApp(store,remote,{save:{location:'remote',source:'mutation($n:Int!){set(value:$n)}'},fail:{location:'remote',source:'mutation($n:Int!){failAfterWrite(value:$n)}'}});
  const invalid=await app.execute('save',{n:'not an integer'}).settled;assert.equal(invalid.status,'rejected');assert.equal((await db.pool.query('SELECT * FROM counts')).rows.length,0);
  const saved=await app.execute('save',{n:7}).settled;assert.equal(saved.status,'committed');assert.equal(saved.result?.data?.set,7);
  assert.deepEqual((await db.pool.query('SELECT * FROM counts')).rows,[{tenant:'a',value:7}]);
  const read=await remote.execute('{read}').settled;assert.equal(read.status,'committed');assert.equal(read.result?.data?.read,7);
  await assert.rejects(isolate.invoke({tenant:'b',subject:'bob'},{version:'v1',field:'read',args:{}}),/unknown version/);
  const failed=await app.execute('fail',{n:9}).settled;assert.equal(failed.status,'unknown');
  assert.equal((await db.pool.query('SELECT value FROM counts WHERE tenant=$1',['a'])).rows[0].value,9);
  assert.equal(store.query('{count}').data?.count,0,'remote writes never silently mutate local state');
  assert.equal(isolate.active,0,'no isolate survives completion or rejection');
 }finally{store.dispose();await connector.close();await db.cleanup();}
});

test('GraphQL optimistic state → durable explicit operations → rejection rollback and lost-ack reconciliation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pg-composed-replica-'));
 const store=local(),history=store.snapshot();const seen:number[]=[];const unsubscribe=store.watch('{count}',r=>seen.push(r.data?.count as number));
 const server=new FileServer(join(dir,'server.json'));
 let replica=createReplica(await server.load());
 const syncLocal=()=>store.mutate('mutation($n:Int!){setCount(value:$n)}',{n:optimistic(replica).data.count??0});
 const command=(id:string,value:number):Operation=>({id,epoch:1,schema:1,baseVersion:replica.confirmed.version,key:'count',value,expiresAt:100});
 try {
  const rejected=command('denied',7);replica=enqueue(replica,rejected);syncLocal();assert.equal(store.query('{count}').data?.count,7);
  replica=markDispatched(replica,rejected.id);const no=await server.commit(rejected,{canWrite:false},10);assert.equal(no.receipt.reason,'forbidden');
  replica=reconcile(replica,no.server,[no.receipt]);syncLocal();assert.equal(store.query('{count}').data?.count,0);
  const accepted=command('accepted',4);replica=enqueue(replica,accepted);replica=markDispatched(replica,accepted.id);syncLocal();
  const yes=await server.commit(accepted,{canWrite:true},11);assert.equal(yes.receipt.status,'accepted');
  // Drop the response, restart the durable adapter, retry the identical command.
  const restart=new FileServer(join(dir,'server.json'));const retry=await restart.commit(accepted,{canWrite:true},12);assert.deepEqual(retry.receipt,yes.receipt);assert.equal(retry.server.effects.length,1);
  replica=reconcile(replica,retry.server,[retry.receipt]);syncLocal();assert.equal(replica.pending.length,0);assert.equal(store.query('{count}').data?.count,4);
  const stale={...accepted,id:'other-client',value:99};const conflict=await restart.commit(stale,{canWrite:true},13);assert.equal(conflict.receipt.reason,'conflict');assert.equal(conflict.server.data.count,4);
  const second=createReplica(conflict.server);assert.deepEqual(optimistic(second),optimistic(replica));
  assert.deepEqual(history.state,{count:0},'captured history does not read live replica state');assert.deepEqual(seen,[0,7,0,4]);
  unsubscribe();store.mutate('mutation{setCount(value:5)}');assert.deepEqual(seen,[0,7,0,4]);
 }finally{store.dispose();await rm(dir,{recursive:true,force:true});}
});
