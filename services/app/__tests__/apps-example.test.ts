/**
 * THE APPS REFERENCE, PUBLISHED. `references/apps.md` teaches one shared expense tab: an empty
 * stored dataset with `user` columns, a page whose rows record `$_me`, and a guest branch. A
 * reference is only real if the door accepts it, so this test reads the fences OUT of that file —
 * the dataset definition and the page, byte for byte — and puts them through the same handlers an
 * `afbin push` uses. An edit to the doc that the product would refuse fails here, not in a session
 * with a person waiting.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {PATCH as patchArtifact} from '@/app/api/artifacts/[id]/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {GET as anonymousQuery,POST as query} from '@/app/a/[id]/query/route';
import {getArtifactById} from '@/lib/artifacts';
import {link,unlink} from '@/lib/relations';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {observedRequest} from '@/__tests__/conditional-request';
import {viewersWritePolicy} from '@artifactbin/utils';
import {agentCookie,request,useAppHarness} from './harness';
useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
const REFERENCE=path.resolve(process.cwd(),'skills/artifactbin/references/apps.md');
const fences=[...readFileSync(REFERENCE,'utf8').matchAll(/```jsx\n([\s\S]*?)```/g)].map(m=>m[1]!);
/** The two fences the reference teaches, by what they are — not by their order in the file. */
const DATASET=fences.find(text=>text.includes('<Dataset kind="stored">'))!;
const PAGE=fences.find(text=>text.includes('<Helmet>'))!;

async function tab(){
 const owner=await mintToken('tab-owner');
 const friend=await mintToken('tab-friend');
 const user=await createUser({email:'mxmx_test_tab_friend@example.com'});
 await claimToken(user.id,friend.token);
 const publish=async(body:object)=>{
  const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));
  expect(r.status,await r.clone().text()).toBe(201);
  return (await r.json()).id as string;
 };
 // `afbin push tab.yaml --policy viewers-write`: the definition, readwrite, then the grant.
 const ds=await publish({dataset:DATASET,access:'readwrite'});
 const head=await getArtifactById(ds);
 // The shorthand grants the dataset's two ordinary stored tables.
 const policy=viewersWritePolicy([{schema:'public',name:'expenses'},{schema:'public',name:'members'}]);
 const granted=await patchArtifact(await observedRequest(`/api/artifacts/${ds}`,{method:'PATCH',token:owner.token,json:{policy,expectedPolicyRevision:head!.policy_revision??0}}),ctx(ds));
 expect(granted.status,await granted.clone().text()).toBe(200);
 const doc=await publish({markup:PAGE.replaceAll('ref:tab123',`ref:${ds}`)});
 const cookie=await agentCookie([friend.id]);
 const run=(mutation:string,body:Record<string,unknown>={},auth?:string)=>mutate(request(`/a/${doc}/mutate`,{method:'POST',cookie:auth,json:{mutation,...body}}),ctx(doc));
 const read=async(auth?:string)=>{
  const r=auth?await query(request(`/a/${doc}/query`,{method:'POST',cookie:auth,json:{}}),ctx(doc)):await anonymousQuery(request(`/a/${doc}/query?q=%7B%7D`),ctx(doc));
  expect(r.status,await r.clone().text()).toBe(200);
  return r.json();
 };
 return {owner,friend,user,ds,doc,cookie,run,read};
}

it('publishes the reference, joins once and uses members independently of Likes',async()=>{
 const f=await tab();
 expect((await f.read()).tables.balances.rows).toEqual([]);
 expect((await f.read(f.cookie)).tables.participant.rows).toEqual([]);
 await link(f.user.id,'like',f.doc);
 expect((await f.read(f.cookie)).tables.participant.rows).toEqual([]);
 const joined=await f.run('join',{},f.cookie);
 expect(joined.status,await joined.clone().text()).toBe(200);
 expect(await joined.json()).toMatchObject({affected:1});
 const repeated=await f.run('join',{},f.cookie);
 expect(await repeated.json()).toMatchObject({affected:0});
 const ready=await f.read(f.cookie);
 expect(ready.tables.participant.rows).toEqual([{person:f.user.id}]);
 expect(ready.tables.members.rows).toEqual([{person:f.user.id}]);
 expect(ready.people[f.user.id]).toBeDefined();
 expect(ready.mutationAccess.add).toBe(null);
 const added=await f.run('add',{row:{person:f.user.id},values:{item:'Taxi',amount:48.5,spent_on:'2026-09-14'}},f.cookie);
 expect(added.status,await added.clone().text()).toBe(200);
 expect(await added.json()).toMatchObject({affected:1});
 const state=await f.read();
 expect(state.tables.tab.rows).toMatchObject([{item:'Taxi',amount:48.5,spent_on:'2026-09-14',paid_by:f.user.id}]);
 expect(state.tables.balances.rows).toMatchObject([{person:f.user.id,net:0}]);
 await unlink(f.user.id,'like',f.doc);
 const left=await f.read(f.cookie);
 expect(left.tables.participant.rows).toEqual([{person:f.user.id}]);
 expect(left.tables.tab.rows).toHaveLength(1);
});

it('offers guests sign-in and refuses direct writes before row validation',async()=>{
 const f=await tab();
 const capability=await f.read();
 expect(capability.mutationAccess.add).toBe('sign_in_required');
 expect(capability.tables.participant.rows).toEqual([]);
 expect(capability.mutationAccess.join).toBe('sign_in_required');
 const guestJoin=await f.run('join',{values:{_me:f.user.id}});
 expect(guestJoin.status).toBe(403);
 for(const body of [{},{row:{person:f.user.id}},{row:{nonsense:'x'}}]){
  const refused=await f.run('add',body);
  expect(refused.status,await refused.clone().text()).toBe(403);
  expect(await refused.json()).toMatchObject({error:'policy_denied',code:'sign_in_required'});
 }
 expect((await f.read()).tables.tab.rows).toEqual([]);
 await link(f.user.id,'like',f.doc);
 expect((await f.read(f.cookie)).mutationAccess.add).toBe(null);
});

it('refuses blank descriptions and nonpositive amounts without storing a row',async()=>{
 const f=await tab();
 expect((await f.run('join',{},f.cookie)).status).toBe(200);
 for(const values of [{item:null,amount:12},{item:'  ',amount:12},{item:'Taxi',amount:null},{item:'Taxi',amount:0},{item:'Taxi',amount:-3}]){
  const result=await f.run('add',{row:{person:f.user.id},values:{...values,spent_on:'2026-09-14'}},f.cookie);
  expect(result.status,await result.clone().text()).not.toBe(200);
 }
 expect((await f.read()).tables.tab.rows).toEqual([]);
});

it('shares participant options and balances between two accounts, including concurrent joins',async()=>{
 const f=await tab();
 const token=await mintToken('second-friend');
 const second=await createUser({email:'mxmx_test_tab_second@example.com'});
 await claimToken(second.id,token.token);
 const cookie=await agentCookie([token.id]);
 const joins=await Promise.all([f.run('join',{},f.cookie),f.run('join',{},f.cookie),f.run('join',{},cookie)]);
 for(const response of joins)expect(response.status,await response.clone().text()).toBe(200);
 expect((await f.read()).tables.members.rows.map((r:{person:string})=>r.person).sort()).toEqual([f.user.id,second.id].sort());
 const added=await f.run('add',{row:{person:f.user.id},values:{item:'Dinner',amount:40,spent_on:'2026-09-14'}},f.cookie);
 expect(added.status,await added.clone().text()).toBe(200);
 expect((await f.read(cookie)).tables.balances.rows).toEqual([{person:f.user.id,net:20},{person:second.id,net:-20}]);
});
