import {expect,it,vi} from 'vitest';
import {services,setServices} from '@/lib/services';
import {getDb} from '@/lib/db';
import {request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/api/artifacts/[id]/mutate/route';
import {GET as read} from '@/app/api/artifacts/[id]/route';
import {mintToken} from '@/lib/tokens';
useAppHarness();
it('retrying one mutation identity returns its durable response without applying the SQL twice',async()=>{
 const token=await mintToken('mxmx_test_mutation_recovery');
 const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));expect(initial.status).toBe(201);const doc=await initial.json();
 const params={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}/mutate`;
 const send=async(sql='insert into public.rows (n) values (2)')=>{
  const req=request(path,{method:'POST',token:token.token,json:{sql}});req.headers.set('Idempotency-Key','mxmx_test_mutation_once');return mutate(req,params);
 };
 const first=await send();expect(first.status).toBe(200);const receipt=await first.json();
 const replay=await send();expect(replay.status).toBe(200);expect(await replay.json()).toEqual(receipt);
 const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),params);expect((await state.json()).rows).toEqual([{n:1},{n:2}]);
 expect((await send('insert into public.rows (n) values (3)')).status).toBe(409);
});

it('concurrent and interrupted retries cannot spend a second generation call',async()=>{
 const original=services();let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});let began!:()=>void;const started=new Promise<void>(resolve=>{began=resolve;});
 const generate=vi.fn(async()=>{began();await waiting;return {json:'{"ok":true}',usage:{input:1,output:1}};});
 setServices({generation:{generate}});
 try{
  const token=await mintToken('mxmx_test_generation_receipt');
  const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{result:'seed'}],access:'readwrite'}}));expect(initial.status).toBe(201);const doc=await initial.json();
  const params={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}/mutate`;
  const config=JSON.stringify({model:'default',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}});
  const send=()=>{const req=request(path,{method:'POST',token:token.token,json:{sql:`insert into public.rows select llm('hello','answer','${config}')`}});req.headers.set('Idempotency-Key','mxmx_test_generation_once');return mutate(req,params);};
  const first=send();await started;
  const busy=await send();expect(busy.status).toBe(409);expect((await busy.json()).error).toBe('operation_pending');expect(generate).toHaveBeenCalledTimes(1);
  release();const completed=await first;expect(completed.status).toBe(200);const receipt=await completed.json();
  expect(await (await send()).json()).toEqual(receipt);expect(generate).toHaveBeenCalledTimes(1);
 }finally{release();setServices(original);}
});

it('receipt storage and the dataset pointer commit atomically; a failed commit never re-executes the claimed operation',async()=>{
 const token=await mintToken('mxmx_test_atomic_receipt');const db=await getDb();
 const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));const doc=await initial.json();
 await db.query('ALTER TABLE mutation_receipts ADD CONSTRAINT mxmx_test_refuse_receipt CHECK (response IS NULL)');
 const params={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}/mutate`;
 const send=()=>{const req=request(path,{method:'POST',token:token.token,json:{sql:'insert into public.rows (n) values (2)'}});req.headers.set('Idempotency-Key','mxmx_test_atomic_receipt');return mutate(req,params);};
 try{await send();}catch{/* The injected database failure may propagate through the direct handler. */}
 const current=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),params);expect((await current.json()).rows).toEqual([{n:1}]);
 await db.query('ALTER TABLE mutation_receipts DROP CONSTRAINT mxmx_test_refuse_receipt');
 const retry=await send();expect(retry.status).toBe(409);expect((await retry.json()).error).toBe('operation_pending');
});

it('observed-state mutations reject a stale head before executing SQL',async()=>{
 const token=await mintToken('mxmx_test_observed_mutation');
 const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));const doc=await initial.json();
 const req=request(`/api/artifacts/${doc.id}/mutate`,{method:'POST',token:token.token,json:{sql:'insert into public.rows (n) values (2)',expectedState:'0'.repeat(64)}});req.headers.set('Idempotency-Key','mxmx_test_stale_mutation');
 const result=await mutate(req,{params:Promise.resolve({id:doc.id})});expect(result.status).toBe(409);expect((await result.json()).error).toBe('row_changed');
 const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),{params:Promise.resolve({id:doc.id})});expect((await state.json()).rows).toEqual([{n:1}]);
});

it('a governance change during generation prevents the observed-state write from committing',async()=>{
 const original=services(),db=await getDb();const token=await mintToken('mxmx_test_generation_race');
 const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{result:'seed'}],access:'readwrite'}}));const doc=await initial.json();
 const generate=vi.fn(async()=>{await db.query('UPDATE artifacts SET sharing_revision=sharing_revision+1 WHERE id=$1',[doc.id]);return {json:'{"ok":true}',usage:{input:1,output:1}};});setServices({generation:{generate}});
 try{
  const config=JSON.stringify({model:'default',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}});
  const req=request(`/api/artifacts/${doc.id}/mutate`,{method:'POST',token:token.token,json:{sql:`insert into public.rows select llm('hello','answer','${config}')`,expectedState:doc.state}});req.headers.set('Idempotency-Key','mxmx_test_generation_race');
  const result=await mutate(req,{params:Promise.resolve({id:doc.id})});expect(result.status).toBe(409);expect((await result.json()).error).toBe('row_changed');expect(generate).toHaveBeenCalledTimes(1);
  const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),{params:Promise.resolve({id:doc.id})});expect((await state.json()).rows).toEqual([{result:'seed'}]);
 }finally{setServices(original);}
});
