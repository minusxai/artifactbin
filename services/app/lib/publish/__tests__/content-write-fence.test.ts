/**
 * THE CONTENT WRITE FENCE through the real HTTP doors. A content write (PUT, revert) names the version and
 * state it read, and is refused only when what it replaces moved: a newer version (`changed: 'content'`) or the
 * title, description or metadata without one (`changed: 'details'`). Sharing, visibility, link role and dataset
 * policy are not content: a change to them between the read and the publish never refuses it. Writes OF those
 * settings carry their own revision fences (expectedSharingRevision, expectedPolicyRevision).
 */
import {describe,expect,it} from 'vitest';
import {mintAccountToken,request,useAppHarness} from '@/__tests__/harness';
import {identityForUser} from '@/lib/accounts';
import {updateSharingFor} from '@/lib/artifacts';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace,PATCH as patch} from '@/app/api/artifacts/[id]/route';
import {POST as revert} from '@/app/api/artifacts/[id]/revert/route';
import {POST as mutate} from '@/app/api/artifacts/[id]/mutate/route';
import {PUT as writePolicy} from '@/app/api/artifacts/[id]/policy/route';

useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
const page=(text:string)=>`<!doctype html><html><head><title>Fence</title></head><body><p>${text}</p></body></html>`;
type Head={version:number;state:string;sharing_revision:number;policy_revision:number;title:string|null};
type Owner=Awaited<ReturnType<typeof mintAccountToken>>;

async function owner(name='fence-owner'){const token=await mintAccountToken(name);return {token,actor:identityForUser(token.userId,token.id)};}
async function publish(token:Owner,body:Record<string,unknown>):Promise<string>{
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'private',...body}}));
 expect(response.status,await response.clone().text()).toBe(201);
 return (await response.json()).id as string;
}
async function head(token:Owner,id:string):Promise<Head>{
 const response=await read(request(`/api/artifacts/${id}`,{token:token.token}),params(id));
 expect(response.status).toBe(200);
 return await response.json() as Head;
}
async function call(handler:typeof replace,token:Owner,id:string,method:string,json:Record<string,unknown>,path=`/api/artifacts/${id}`){
 const response=await handler(request(path,{method,token:token.token,json}),params(id));
 return {status:response.status,body:await response.json() as Record<string,unknown>};
}
const put=(token:Owner,id:string,json:Record<string,unknown>)=>call(replace,token,id,'PUT',json);
const metadata=(token:Owner,id:string,json:Record<string,unknown>)=>call(patch,token,id,'PATCH',json);
const observed=(seen:Head)=>({expectedVersion:seen.version,expectedState:seen.state});
const policy={version:3,tables:[{table:{schema:'public',name:'rows'},
 select_permissions:['viewer','signed_in','anonymous'].map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),
 insert_permissions:['viewer','signed_in'].map(role=>({role,permission:{columns:'*',check:{}}}))}]};

describe('a content write after an access-settings change',()=>{
 it('publishes a page whose shares and link role changed after the read',async()=>{
  const me=await owner(),id=await publish(me.token,{html:page('One')}),seen=await head(me.token,id);
  await updateSharingFor(me.actor,id,{shares:[{email:'mxmx_test_reader@example.test',role:'commenter'}],linkRole:'commenter'});
  const after=await head(me.token,id);
  expect(after.sharing_revision).toBeGreaterThan(seen.sharing_revision);
  expect(after.state).toBe(seen.state);
  const saved=await put(me.token,id,{html:page('Two'),...observed(seen)});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  expect(saved.body).toMatchObject({version:seen.version+1});
 });

 it('publishes a page whose visibility changed after the read, through the fenced metadata door',async()=>{
  const me=await owner(),id=await publish(me.token,{html:page('One')}),seen=await head(me.token,id);
  const shared=await metadata(me.token,id,{visibility:'unlisted',expectedState:seen.state,expectedSharingRevision:seen.sharing_revision});
  expect(shared.status,JSON.stringify(shared.body)).toBe(200);
  const saved=await put(me.token,id,{html:page('Two'),...observed(seen)});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  expect((await head(me.token,id)).version).toBe(seen.version+1);
 });

 it('republishes a dataset whose policy changed after the read',async()=>{
  const me=await owner(),id=await publish(me.token,{dataset:[{n:1}],access:'readwrite'}),seen=await head(me.token,id);
  const set=await call(writePolicy,me.token,id,'PUT',{policy,expectedPolicyRevision:seen.policy_revision},`/api/artifacts/${id}/policy`);
  expect(set.status,JSON.stringify(set.body)).toBe(200);
  const saved=await put(me.token,id,{dataset:[{n:1},{n:2}],...observed(seen)});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
 });

 it('reverts a page whose sharing changed after the read',async()=>{
  const me=await owner(),id=await publish(me.token,{html:page('One')}),first=await head(me.token,id);
  expect((await put(me.token,id,{html:page('Two'),...observed(first)})).status).toBe(200);
  const seen=await head(me.token,id);
  await updateSharingFor(me.actor,id,{linkRole:'commenter'});
  const reverted=await call(revert,me.token,id,'POST',{version:1,...observed(seen)},`/api/artifacts/${id}/revert`);
  expect(reverted.status,JSON.stringify(reverted.body)).toBe(200);
 });
});

describe('a genuine conflict names what changed',()=>{
 it('refuses a publish read before a newer version with changed: content',async()=>{
  const me=await owner(),id=await publish(me.token,{html:page('One')}),seen=await head(me.token,id);
  expect((await put(me.token,id,{html:page('Theirs'),...observed(seen)})).status).toBe(200);
  const current=await head(me.token,id);
  expect(await put(me.token,id,{html:page('Mine'),...observed(seen)})).toEqual({status:409,body:{error:'version_conflict',currentVersion:current.version,currentState:current.state,changed:'content'}});
 });

 it('refuses a publish read before a title change with changed: details, at the same version',async()=>{
  const me=await owner(),id=await publish(me.token,{html:page('One')}),seen=await head(me.token,id);
  expect((await metadata(me.token,id,{title:'Renamed',expectedState:seen.state})).status).toBe(200);
  const current=await head(me.token,id);
  expect(current.version).toBe(seen.version);
  expect(await put(me.token,id,{html:page('Mine'),...observed(seen)})).toEqual({status:409,body:{error:'version_conflict',currentVersion:seen.version,currentState:current.state,changed:'details'}});
  expect((await head(me.token,id)).title).toBe('Renamed');
 });

 it('refuses a revert read before a newer version with changed: content',async()=>{
  const me=await owner(),id=await publish(me.token,{html:page('One')}),seen=await head(me.token,id);
  expect((await put(me.token,id,{html:page('Two'),...observed(seen)})).status).toBe(200);
  const reverted=await call(revert,me.token,id,'POST',{version:1,...observed(seen)},`/api/artifacts/${id}/revert`);
  expect(reverted).toMatchObject({status:409,body:{error:'version_conflict',changed:'content'}});
 });
});

describe('writes of access settings keep their own fences',()=>{
 it('requires the observed sharing revision to change visibility, link role or shares, and refuses a stale one',async()=>{
  const me=await owner(),id=await publish(me.token,{html:page('One')}),seen=await head(me.token,id);
  expect(await metadata(me.token,id,{visibility:'unlisted',expectedState:seen.state})).toMatchObject({status:400,body:{error:'sharing_revision_required'}});
  await updateSharingFor(me.actor,id,{shares:[{email:'mxmx_test_reader@example.test',role:'viewer'}]});
  expect(await metadata(me.token,id,{linkRole:'commenter',expectedState:seen.state,expectedSharingRevision:seen.sharing_revision})).toMatchObject({status:409,body:{error:'version_conflict',changed:'sharing'}});
  const fresh=await head(me.token,id);
  expect((await metadata(me.token,id,{linkRole:'commenter',expectedState:fresh.state,expectedSharingRevision:fresh.sharing_revision})).status).toBe(200);
  // A visibility change moves the sharing revision, so a second writer from the same read is refused.
  expect(await metadata(me.token,id,{visibility:'unlisted',expectedState:fresh.state,expectedSharingRevision:fresh.sharing_revision})).toMatchObject({status:409,body:{error:'version_conflict',changed:'sharing'}});
  // A details write still fences on state alone: the sharing changes above did not move it.
  expect((await metadata(me.token,id,{title:'Still mine',expectedState:seen.state})).status).toBe(200);
 });

 it('fences a publish that also changes visibility on the sharing revision, and lets an unchanged value ride free',async()=>{
  const me=await owner(),id=await publish(me.token,{html:page('One')}),seen=await head(me.token,id);
  expect(await put(me.token,id,{html:page('Two'),visibility:'unlisted',...observed(seen)})).toMatchObject({status:400,body:{error:'sharing_revision_required'}});
  expect((await put(me.token,id,{html:page('Two'),visibility:'private',...observed(seen)})).status).toBe(200);
  const now=await head(me.token,id);
  await updateSharingFor(me.actor,id,{linkRole:'commenter'});
  expect(await put(me.token,id,{html:page('Three'),visibility:'unlisted',expectedSharingRevision:now.sharing_revision,...observed(now)})).toMatchObject({status:409,body:{error:'version_conflict',changed:'sharing'}});
  const fresh=await head(me.token,id);
  expect(await put(me.token,id,{html:page('Three'),visibility:'unlisted',expectedSharingRevision:fresh.sharing_revision,...observed(fresh)})).toMatchObject({status:200,body:{visibility:'unlisted'}});
 });

 it('refuses a policy write from a stale policy revision with changed: policy',async()=>{
  const me=await owner(),id=await publish(me.token,{dataset:[{n:1}],access:'readwrite'}),seen=await head(me.token,id);
  expect((await metadata(me.token,id,{policy,expectedPolicyRevision:seen.policy_revision,expectedState:seen.state})).status).toBe(200);
  expect(await metadata(me.token,id,{policy,expectedPolicyRevision:seen.policy_revision,expectedState:seen.state})).toMatchObject({status:409,body:{error:'version_conflict',changed:'policy'}});
 });

 it('refuses a prepared dataset mutation when the policy changed since it was prepared',async()=>{
  const me=await owner(),id=await publish(me.token,{dataset:[{n:1}],access:'readwrite'}),seen=await head(me.token,id);
  const set=await call(writePolicy,me.token,id,'PUT',{policy,expectedPolicyRevision:seen.policy_revision},`/api/artifacts/${id}/policy`);
  expect(set.status,JSON.stringify(set.body)).toBe(200);
  const write=(json:Record<string,unknown>)=>call(mutate,me.token,id,'POST',{sql:'insert into public.rows values (2)',...json},`/api/artifacts/${id}/mutate`);
  expect(await write({expectedState:seen.state,expectedPolicyRevision:seen.policy_revision})).toMatchObject({status:409,body:{error:'row_changed'}});
  const fresh=await head(me.token,id);
  expect(fresh.state).toBe(seen.state);
  expect(await write({expectedState:fresh.state,expectedPolicyRevision:fresh.policy_revision})).toMatchObject({status:200,body:{affected:1,rowCount:2}});
 });
});
