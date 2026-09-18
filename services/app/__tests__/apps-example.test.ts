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
 // The shorthand takes the dataset's OWN tables: this one declares two, and a grant naming a
 // table it does not have is refused after the content is already published.
 const policy=viewersWritePolicy([{schema:'public',name:'people'},{schema:'public',name:'expenses'}]);
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

/**
 * The tab, as the reference tells an agent to build it: nobody in it, then a person joins by
 * pressing one button, and their expense lands under THEIR account and a real date.
 */
it('publishes the reference’s dataset and page, and a signed-in viewer joins and adds an expense',async()=>{
 const f=await tab();
 // It starts genuinely empty: no seed row, no invented person.
 expect((await f.read()).tables.balances.rows).toEqual([]);

 // The join button is drawn by `<For each={$to_join}>`, so the page offers it
 // only while that query has a row — and a press carries that row, exactly as
 // the runtime's row action does.
 const offered=(await f.read(f.cookie)).tables.to_join.rows;
 expect(offered).toMatchObject([{person:f.user.id}]);
 const joined=await f.run('join',{row:offered[0]},f.cookie);
 expect(joined.status,await joined.clone().text()).toBe(200);
 expect(await joined.json()).toMatchObject({affected:1});
 // Having joined, the button is gone: the query that drew it is empty.
 expect((await f.read(f.cookie)).tables.to_join.rows).toEqual([]);
 // …and `where not exists` is what makes pressing a stale one harmless.
 const again=await f.run('join',{row:offered[0]},f.cookie);
 expect(again.status,await again.clone().text()).toBe(200);
 expect(await again.json()).toMatchObject({affected:0});

 const added=await f.run('add',{values:{item:'Taxi',amount:48.5,spent_on:'2026-09-14'}},f.cookie);
 expect(added.status,await added.clone().text()).toBe(200);
 expect(await added.json()).toMatchObject({affected:1});

 const state=await f.read();
 expect(state.tables.tab.rows).toMatchObject([{item:'Taxi',amount:48.5,spent_on:'2026-09-14',paid_by:f.user.id}]);
 expect(state.tables.balances.rows).toMatchObject([{person:f.user.id,net:0}]);
});

/**
 * THE GUEST BRANCH the page draws `<SignIn>` from. A `$_me` write has one honest answer for a
 * signed-out reader, and it is a door, not a stack trace.
 */
it('offers a guest the sign-in door instead of a refusal an agent has to translate',async()=>{
 const f=await tab();
 const capability=await f.read();
 expect(capability.mutationAccess.join).toBe('sign_in_required');
 expect(capability.mutationAccess.add).toBe('sign_in_required');
 // A guest is never OFFERED the button: the query that draws it is empty for
 // someone with no account, which is what keeps a null row key off the page.
 expect((await f.read()).tables.to_join.rows).toEqual([]);
 // Pressed anyway — a stale tab, an agent posting straight at the door, with or
 // without the row snapshot a row action normally carries — the answer is the
 // DOOR, not a lecture about row snapshots: sign-in is the one refusal a reader
 // can act on, so it is decided before the shape of the call is judged.
 for(const body of [{},{row:{person:f.user.id}},{row:{nonsense:'x'}}]){
  const refused=await f.run('join',body);
  expect(refused.status,await refused.clone().text()).toBe(403);
  expect(await refused.json()).toMatchObject({error:'policy_denied',code:'sign_in_required'});
 }
 // The same page, for the person who is signed in, simply works.
 expect((await f.read(f.cookie)).mutationAccess.add).toBe(null);
});
