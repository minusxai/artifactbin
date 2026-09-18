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
 // The shorthand grants only the dataset's own expenses table.
 const policy=viewersWritePolicy([{schema:'public',name:'expenses'}]);
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

it('publishes the reference and uses Like to participate and add an expense',async()=>{
 const f=await tab();
 expect((await f.read()).tables.balances.rows).toEqual([]);
 expect((await f.read(f.cookie)).tables.participant.rows).toEqual([]);
 await link(f.user.id,'like',f.doc);
 const ready=await f.read(f.cookie);
 expect(ready.tables.participant.rows).toEqual([{person:f.user.id}]);
 expect(ready.mutationAccess.add).toBe(null);
 const added=await f.run('add',{row:{person:f.user.id},values:{item:'Taxi',amount:48.5,spent_on:'2026-09-14'}},f.cookie);
 expect(added.status,await added.clone().text()).toBe(200);
 expect(await added.json()).toMatchObject({affected:1});
 const state=await f.read();
 expect(state.tables.tab.rows).toMatchObject([{item:'Taxi',amount:48.5,spent_on:'2026-09-14',paid_by:f.user.id}]);
 expect(state.tables.balances.rows).toMatchObject([{person:f.user.id,net:0}]);
 await unlink(f.user.id,'like',f.doc);
 const left=await f.read(f.cookie);
 expect(left.tables.participant.rows).toEqual([]);
 expect(left.tables.tab.rows).toHaveLength(1);
});

it('offers guests sign-in and refuses direct writes before row validation',async()=>{
 const f=await tab();
 const capability=await f.read();
 expect(capability.mutationAccess.add).toBe('sign_in_required');
 expect(capability.tables.participant.rows).toEqual([]);
 for(const body of [{},{row:{person:f.user.id}},{row:{nonsense:'x'}}]){
  const refused=await f.run('add',body);
  expect(refused.status,await refused.clone().text()).toBe(403);
  expect(await refused.json()).toMatchObject({error:'policy_denied',code:'sign_in_required'});
 }
 expect((await f.read()).tables.tab.rows).toEqual([]);
 await link(f.user.id,'like',f.doc);
 expect((await f.read(f.cookie)).mutationAccess.add).toBe(null);
});
