import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {PATCH as patch,GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {mintToken} from '@/lib/tokens';
import {getDb} from '@/lib/db';
useAppHarness();
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
