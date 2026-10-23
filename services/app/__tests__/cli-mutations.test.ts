import {nativeSource} from './native-publication-fixture';
/**
 * The REAL CLI through the REAL data handlers: SQL reads and writes, declared mutations, dataset
 * definitions, governance policy, and the durable recovery that makes a lost reply finishable.
 */

import { expect, it, vi } from 'vitest';
import { identityForUser } from '@/lib/accounts';
import { getArtifactById, setMutationInvocation } from '@/lib/artifacts';
import type { MutationInvocation } from '@/lib/artifacts/mutation-invocation';
import { getDb } from '@/lib/platform';
import { request, useAppHarness } from './harness';
import { cliWorkspace } from './cli-harness';
import { POST as reserve } from '@/app/api/artifacts/reservations/route';
import { POST as create, GET as list } from '@/app/api/artifacts/route';
import { POST as mutate } from '@/app/api/artifacts/[id]/mutate/route';
import { GET as read, PUT as replace, PATCH as metadata, PATCH as patch } from '@/app/api/artifacts/[id]/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { GET as versions } from '@/app/api/artifacts/[id]/versions/route';
import { loadDatasetRows } from '@/lib/datasets/dataset-store';
import { POST as queryRead } from '@/app/api/artifacts/[id]/query/route';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GET as content } from '@/app/api/artifacts/[id]/content/route';
import { readRecord } from '../../cli/test/tracking';
import { parseResourceFile, writeResourceFile } from '../../cli/src/resource-file';
import { POST as preflight } from '@/app/api/artifacts/preflight/route';
import { POST as secrets } from '@/app/api/my/secrets/route';
import { resolveDatasetConnection } from '@/lib/datasets/secrets';
import { DatasetError } from '@/lib/datasets/errors';

useAppHarness();

describe('cli-mutation-recovery', () => {
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

  it('concurrent and interrupted retries cannot execute a second mutation invocation',async()=>{
   let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});let began!:()=>void;const started=new Promise<void>(resolve=>{began=resolve;});
   const run=vi.fn(async(...[input,engine]:Parameters<MutationInvocation['run']>)=>{began();await waiting;return engine.mutate(input);});
   setMutationInvocation(()=>({run}));
   try{
    const token=await mintToken('mxmx_test_invocation_receipt');
    const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{result:'seed'}],access:'readwrite'}}));expect(initial.status).toBe(201);const doc=await initial.json();
    const params={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}/mutate`;
    const send=()=>{const req=request(path,{method:'POST',token:token.token,json:{sql:"insert into public.rows (result) values ('next')"}});req.headers.set('Idempotency-Key','mxmx_test_invocation_once');return mutate(req,params);};
    const first=send();await Promise.race([started,first.then(()=>{throw new Error('Mutation invocation did not begin');})]);
    const busy=await send();expect(busy.status).toBe(409);expect((await busy.json()).error).toBe('operation_pending');expect(run).toHaveBeenCalledTimes(1);
    release();const completed=await first;expect(completed.status).toBe(200);const receipt=await completed.json();
    expect(await (await send()).json()).toEqual(receipt);expect(run).toHaveBeenCalledTimes(1);
   }finally{release();setMutationInvocation(undefined);}
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

  it('a governance change during mutation execution prevents the observed-state write from committing',async()=>{
   const db=await getDb();const token=await mintToken('mxmx_test_invocation_race');
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{result:'seed'}],access:'readwrite'}}));const doc=await initial.json();
   const run=vi.fn(async(...[input,engine]:Parameters<MutationInvocation['run']>)=>{await db.query('UPDATE artifacts SET sharing_revision=sharing_revision+1 WHERE id=$1',[doc.id]);return engine.mutate(input);});setMutationInvocation(()=>({run}));
   try{
    const req=request(`/api/artifacts/${doc.id}/mutate`,{method:'POST',token:token.token,json:{sql:"insert into public.rows (result) values ('next')",expectedState:doc.state}});req.headers.set('Idempotency-Key','mxmx_test_invocation_race');
    const result=await mutate(req,{params:Promise.resolve({id:doc.id})});expect(result.status).toBe(409);expect((await result.json()).error).toBe('row_changed');expect(run).toHaveBeenCalledTimes(1);
    const state=await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),{params:Promise.resolve({id:doc.id})});expect((await state.json()).rows).toEqual([{result:'seed'}]);
   }finally{setMutationInvocation(undefined);}
  });
});

describe('cli-declared-mutations', () => {
  const ctx=(id:string)=>({params:Promise.resolve({id})});
  it('filters version history by author and time interval',async()=>{
   const owner=await mintToken('mxmx_test_history');
   const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:nativeSource('<p>v1</p>')}}));expect(r.status).toBe(201);const id=(await r.json()).id as string;
   const all=await versions(request(`/api/artifacts/${id}/versions`,{token:owner.token}),ctx(id));expect(all.status).toBe(200);expect((await all.json()).versions.length).toBeGreaterThanOrEqual(1);
   const nobody=await versions(request(`/api/artifacts/${id}/versions?author=mxmx_nobody`,{token:owner.token}),ctx(id));expect((await nobody.json()).versions).toHaveLength(0);
   const future=await versions(request(`/api/artifacts/${id}/versions?since=2099-01-01T00:00:00Z`,{token:owner.token}),ctx(id));expect((await future.json()).versions).toHaveLength(0);
   const bad=await versions(request(`/api/artifacts/${id}/versions?since=yesterday`,{token:owner.token}),ctx(id));expect(bad.status).toBe(400);
  });
});

describe('cli-query-integration', () => {
  it('a dataset query naming an undeclared $parameter is refused as a 400 the agent can read, never a 500 (local eval leg: pi lost four calls to it)',async()=>{
   const token=await mintToken('mxmx_test_cli_undeclared_param');
   const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1},{n:2}],access:'readwrite'}}));expect(made.status).toBe(201);const doc=await made.json();
   const response=await queryRead(request(`/api/artifacts/${doc.id}/query`,{method:'POST',token:token.token,json:{sql:'select sum(n) as total from public.rows where ($team = \'all\' or n = $team)'}}),{params:Promise.resolve({id:doc.id})});
   expect(response.status).toBe(400);
   const body=await response.json();
   expect(body.error).toBe('invalid_sql');
   expect(body.message).toMatch(/undeclared parameter \$team/);
  });
});

describe('cli-policy-metadata', () => {
  it('metadata and dataset policy commit together with both state and policy revision checks',async()=>{
   const token=await mintToken('mxmx_test_policy_metadata');
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite',title:'Before'}}));const doc=await initial.json(),path=`/api/artifacts/${doc.id}`,context={params:Promise.resolve({id:doc.id})};
   const policy={version:1,enforcement:'enabled',tables:[{table:{schema:'public',name:'rows'},insert_permissions:[{role:'viewer',permission:{columns:['n'],check:{}}}]}]};
   const send=(body:object)=>patch(request(path,{method:'PATCH',token:token.token,json:body}),context);
   const first=await send({title:'After',policy,expectedPolicyRevision:0,expectedState:doc.state});expect(first.status,await first.clone().text()).toBe(200);const saved=await first.json();expect(saved.title).toBe('After');expect(saved.dataset_policy).toEqual(policy);expect(saved.policy_revision).toBe(1);
   expect((await send({title:'Stale',policy:null,expectedPolicyRevision:0,expectedState:saved.state})).status).toBe(409);
   const invalid=await send({title:'Invalid',policy:{...policy,tables:[{...policy.tables[0],insert_permissions:[{role:'viewer',permission:{columns:['missing'],check:{}}}]}]},expectedPolicyRevision:1,expectedState:saved.state});expect(invalid.status).toBe(400);
   const current=await (await read(request(path,{token:token.token}),context)).json();expect(current.title).toBe('After');expect(current.policy_revision).toBe(1);
   const audit=await (await getDb()).query('SELECT revision FROM dataset_policy_audit WHERE dataset_id=$1',[doc.id]);expect(audit.rows).toEqual([{revision:1}]);
   const db=await getDb();await db.query('ALTER TABLE dataset_policy_audit ADD CONSTRAINT mxmx_test_policy_audit_failure CHECK (revision<2)');
   try{await send({title:'Must roll back',shares:[{email:'mxmx_test_accidental@example.com',role:'viewer'}],policy:null,expectedPolicyRevision:1,expectedState:saved.state});}catch{/* Injected database failure can propagate through the direct handler. */}
   finally{await db.query('ALTER TABLE dataset_policy_audit DROP CONSTRAINT mxmx_test_policy_audit_failure');}
   const rolledBack=await (await read(request(path,{token:token.token}),context)).json();expect(rolledBack.title).toBe('After');expect(rolledBack.shares).toEqual([]);expect(rolledBack.policy_revision).toBe(1);
  });

  it('refuses unsupported content and policy combinations before creating or replacing data',async()=>{
   const token=await mintToken('mxmx_test_combined_policy'),policy={version:1,enforcement:'enabled',tables:[]};
   const refused=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],policy}}));expect(refused.status).toBe(400);
   expect((await (await getDb()).query('SELECT id FROM artifacts WHERE token_id=$1',[token.id])).rows).toEqual([]);
   const initial=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));const doc=await initial.json();
   const context={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}`;
   const replacement=await replace(request(path,{method:'PUT',token:token.token,json:{dataset:[{n:2}],policy,expectedState:doc.state,expectedVersion:doc.version}}),context);expect(replacement.status).toBe(400);
   const current=await (await read(request(path,{token:token.token}),context)).json();expect(current.rows).toEqual([{n:1}]);expect(current.policy_revision).toBe(0);
  });
});
