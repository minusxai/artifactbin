/**
 * AFTER THE REMOVAL OF PAGE WORKLOADS, ARTIFACT READ GRANTS AND PAGE EVIDENCE, on real handlers and storage:
 *  - what a workload left behind stays readable history: its group page (no person and no token behind it), its
 *    versions and its creation receipt under a `workload:` scope are read through the ordinary doors by the group's
 *    members, and the boot that dropped the workload tables keeps every other table;
 *  - the saved revision's schema (GET /api/artifacts/<page>/sql/schema?revision=N, the skill's `sql.mjs schema
 *    --revision`) still answers a reader of the page with its pinned links under the reader's own policy.
 */
import {expect,it} from 'vitest';
import {storePolicy} from '@/__tests__/artifact-fixtures';
import {createAppHost} from '@/server/host';
import {createGroup} from '@/lib/groups';
import {getDb} from '@/lib/platform';
import {admitGroupMember,mintAccountToken,useAppHarness} from './harness';
useAppHarness();

async function setting(){
 const owner=await mintAccountToken('mxmx_test_history_owner'),member=await mintAccountToken('mxmx_test_history_member'),stranger=await mintAccountToken('mxmx_test_history_stranger'),editor=await mintAccountToken('mxmx_test_history_editor');
 const group=await createGroup(owner.userId!,{handle:'removal_history',name:'History'});
 await admitGroupMember(owner.userId!,group.id,member.userId!,'member');
 await admitGroupMember(owner.userId!,group.id,editor.userId!,'admin');
 const host=await createAppHost();
 const as=(who:typeof owner)=>({credential:'bearer' as const,userId:who.userId!,tokenId:who.id});
 const call=async(who:typeof owner,path:string,method='GET',body?:unknown)=>{
  const response=await host.request(new Request('http://localhost'+path,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'content-type':'application/json'}})}),as(who));
  return {status:response.status,body:await response.json().catch(()=>null) as Record<string,unknown>|null};
 };
 const create=async(body:Record<string,unknown>)=>{const made=await call(owner,'/api/artifacts','POST',body);expect(made.status,JSON.stringify(made.body)).toBe(201);return made.body as {id:string;version:number};};
 return {owner,member,editor,stranger,group,call,create};
}

it('keeps what a workload published readable by its group, through the ordinary doors',async()=>{
 const {owner,member,editor,stranger,group,call,create}=await setting(),db=await getDb();
 // Published as a workload published: a private page of the group, replaced once, with no person or token behind either.
 const page=await create({title:'Nightly report',html:'<html><body><h1>Nightly</h1></body></html>',visibility:'private',destination:{type:'group',id:group.id}});
 const current=await call(owner,'/api/artifacts/'+page.id);
 const replaced=await call(owner,'/api/artifacts/'+page.id,'PUT',{html:'<html><body><h1>Nightly, again</h1></body></html>',expectedVersion:current.body?.version,expectedState:current.body?.state});
 expect(replaced.status,JSON.stringify(replaced.body)).toBe(200);
 await db.query('UPDATE artifacts SET user_id=NULL,token_id=NULL,actor_user_id=NULL,actor_token_id=NULL WHERE id=$1',[page.id]);
 await db.query('UPDATE artifact_versions SET actor_user_id=NULL,actor_token_id=NULL WHERE artifact_id=$1',[page.id]);
 await db.query("INSERT INTO artifact_creation_operations (scope,operation_key,request_hash,artifact_id,response,response_status,response_until) VALUES ($1,$2,$3,$4,$5::jsonb,201,now())",
  ['workload:'+'f'.repeat(64),'0'.repeat(64),'e'.repeat(64),page.id,JSON.stringify({id:page.id})]);
 // Its group's member reads it and its Admin its history, as any page's; a stranger reads neither.
 const read=await call(member,'/api/artifacts/'+page.id);
 expect(read.status,JSON.stringify(read.body)).toBe(200);
 expect(read.body).toMatchObject({id:page.id,version:2});
 const versions=await call(editor,`/api/artifacts/${page.id}/versions`);
 expect(versions.status,JSON.stringify(versions.body)).toBe(200);
 expect(JSON.stringify(versions.body)).toContain('"version":1');
 expect((await call(editor,`/api/artifacts/${page.id}/versions/1`)).status).toBe(200);
 expect((await call(stranger,`/api/artifacts/${page.id}/versions`)).status).toBe(404);
 expect((await call(stranger,'/api/artifacts/'+page.id)).status).toBe(404);
 // The receipt is still there, unread and untouched.
 expect((await db.query('SELECT artifact_id FROM artifact_creation_operations WHERE scope LIKE $1',['workload:%'])).rows).toEqual([{artifact_id:page.id}]);
 // The boot dropped exactly the three workload tables, and kept the pages, their history and the receipts.
 const present=(await db.query<{name:string}>("SELECT table_name AS name FROM information_schema.tables WHERE table_name = ANY($1::text[])",[['workload_publication_intents','workload_publication_audit','workload_publication_outputs','artifacts','artifact_versions','artifact_creation_operations','mutation_receipts']])).rows.map(row=>row.name).sort();
 expect(present).toEqual(['artifact_creation_operations','artifact_versions','artifacts','mutation_receipts']);
});

it('answers a saved revision\'s schema to a reader of the page, its pinned links only, under the reader\'s own policy',async()=>{
 const {owner,member,stranger,group,call,create}=await setting();
 const dataset=await create({title:'Metrics',dataset:[{name:'red',team:'red',secret:'s1'},{name:'blue',team:'blue',secret:'s2'}],visibility:'private',destination:{type:'group',id:group.id}});
 await storePolicy(dataset.id,{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[{role:'viewer',permission:{columns:['name','team'],filter:{}}}]}]});
 const page=await create({title:'Saved',html:`<html><head><link rel="af-dataset" data-af-name="metrics" href="ref:${dataset.id}" data-af-mode="pinned" data-af-revision="1"></head><body>Saved</body></html>`,visibility:'private',destination:{type:'group',id:group.id}});
 const schema=(who:typeof owner,revision='1')=>call(who,`/api/artifacts/${page.id}/sql/schema?revision=${revision}`);
 const answer=await schema(member);
 expect(answer.status,JSON.stringify(answer.body)).toBe(200);
 expect(answer.body).toMatchObject({pageId:page.id,revision:'1',bindings:[{name:'metrics',datasetId:dataset.id,revision:'1'}]});
 const columns=((answer.body!.tables as {columns:{name:string}[]}[])[0]!.columns).map(column=>column.name);
 expect(columns).toEqual(expect.arrayContaining(['name','team']));
 expect(columns).not.toContain('secret');
 // The owner (an Admin) reads every column; a stranger, another revision and a malformed one are refused.
 expect(JSON.stringify((await schema(owner)).body)).toContain('secret');
 expect((await schema(stranger)).status).toBe(404);
 expect((await schema(member,'2')).status).toBe(404);
 expect((await schema(member,'one')).status).toBe(400);
});
