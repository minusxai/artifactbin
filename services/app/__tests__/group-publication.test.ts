import {admitGroupMember} from '@/__tests__/harness';
import {nativeHtml} from './native-html-fixture';
import {afterEach,describe,expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import { createUser } from '@/lib/accounts';
import {createGroup,getGroupDetail,removeGroupMember,setAccountPreferences} from '@/lib/groups';
import {admitDeploymentIdentity,setupDeployment} from '@/lib/deployment';
import {overrideConfig,resetConfigOverrides} from '@/lib/platform/config';
import {getDb} from '@/lib/platform/db';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as start} from '@/app/api/start/route';
useAppHarness();
afterEach(resetConfigOverrides);
async function account(name:string){
 const user=await createUser({email:`mxmx_test_group_publication_${name}@example.com`});
 const token=await mintAccountToken(name,user.id);return{user,token:token.token};
}
async function create(token:string,json:Record<string,unknown>){
 const response=await publish(request('/api/artifacts',{method:'POST',token,json}));
 return{status:response.status,body:await response.json() as {id?:string;error?:string}};
}
async function owner(id:string|undefined){
 const db=await getDb();return(await db.query('SELECT user_id,group_id,creator_user_id FROM artifacts WHERE id=$1',[id])).rows[0];
}
describe('publication uses shared account destination through the real HTTP handler',()=>{
 it('keeps inaccessible group parents indistinguishable from missing parents',async()=>{
  const a=await account('folder-owner'),b=await account('folder-outsider');
  const group=await createGroup(a.user.id,{handle:'private_folders',name:'Private folders'});
  const folder=await create(a.token,{format:'folder',title:'Reports',destination:{type:'group',id:group.id}});
  expect(folder.status).toBe(201);
  const missing=await create(b.token,{html:nativeHtml('<p>Report</p>'),parent_id:'zzzzzz'});
  const inaccessible=await create(b.token,{html:nativeHtml('<p>Report</p>'),parent_id:folder.body.id});
  expect(missing.status).toBe(400);expect(missing.body).toMatchObject({error:'invalid_parent'});
  expect(inaccessible).toEqual(missing);
 });
 it('accepts a present but empty request stream from the HTTP server',async()=>{
  const a=await account('empty-stream');const base=request('/api/start',{method:'POST',token:a.token});
  const incoming=new Request(base.url,{method:'POST',headers:base.headers,body:''});
  expect(incoming.body).not.toBeNull();expect((await start(incoming)).status).toBe(201);
 });
 it.each(['{','[]','null'])('refuses a nonempty invalid starter body %s',async raw=>{
  const a=await account('invalid-body');const base=request('/api/start',{method:'POST',token:a.token});
  const incoming=new Request(base.url,{method:'POST',headers:base.headers,body:raw});
  expect((await start(incoming)).status).toBe(400);
 });
 it('refuses malformed explicit starter destinations instead of ignoring them',async()=>{
  const a=await account('starter');
  const response=await start(request('/api/start',{method:'POST',token:a.token,json:{destination:{type:'personal',id:'unexpected'}}}));
  expect(response.status).toBe(400);
 });
 it('keeps an explicitly Personal starter personal even with a saved group default',async()=>{
  const a=await account('starter');const group=await createGroup(a.user.id,{handle:'starter_group',name:'Starter group'});
  await setAccountPreferences(a.user.id,{type:'group',id:group.id});
  const grouped=await start(request('/api/start',{method:'POST',token:a.token}));
  expect(grouped.status).toBe(201);expect(await owner((await grouped.json()).id)).toMatchObject({group_id:group.id});
  const personal=await start(request('/api/start',{method:'POST',token:a.token,json:{destination:{type:'personal'}}}));
  expect(personal.status).toBe(201);expect(await owner((await personal.json()).id)).toMatchObject({group_id:null,user_id:a.user.id});
 });
 it('applies the saved group to new documents and permits explicit personal publication',async()=>{
  const a=await account('owner');const group=await createGroup(a.user.id,{handle:'publishing',name:'Publishing'});
  await setAccountPreferences(a.user.id,{type:'group',id:group.id});
  const grouped=await create(a.token,{html:nativeHtml('<p id="intro">Group content</p>')});
  expect(grouped.status,JSON.stringify(grouped.body)).toBe(201);
  expect(await owner(grouped.body.id)).toMatchObject({user_id:null,group_id:group.id,creator_user_id:a.user.id});
  const personal=await create(a.token,{html:nativeHtml('<p id="intro">Personal content</p>'),destination:{type:'personal'}});
  expect(personal.status,JSON.stringify(personal.body)).toBe(201);
  expect(await owner(personal.body.id)).toMatchObject({user_id:a.user.id,group_id:null,creator_user_id:a.user.id});
 });
 it('uses parent ownership before the saved preference and refuses conflicting explicit ownership',async()=>{
  const a=await account('owner');const group=await createGroup(a.user.id,{handle:'publishing',name:'Publishing'});
  const folder=await create(a.token,{format:'folder',title:'Personal folder'});expect(folder.status).toBe(201);
  await setAccountPreferences(a.user.id,{type:'group',id:group.id});
  const child=await create(a.token,{html:nativeHtml('<p id="intro">Child</p>'),parent_id:folder.body.id});
  expect(child.status,JSON.stringify(child.body)).toBe(201);
  expect(await owner(child.body.id)).toMatchObject({user_id:a.user.id,group_id:null});
  const conflict=await create(a.token,{html:nativeHtml('<p id="intro">Wrong owner</p>'),parent_id:folder.body.id,destination:{type:'group',id:group.id}});
  expect(conflict.status).toBeGreaterThanOrEqual(400);expect(conflict.status).toBeLessThan(500);
 });
 it('publishes to a member’s saved group by explicit visibility and refuses private publication without an explicit group',async()=>{
  const a=await account('owner'),b=await account('member');const group=await createGroup(a.user.id,{handle:'publishing',name:'Publishing'});
  await admitGroupMember(a.user.id,group.id,b.user.id,'member');
  await setAccountPreferences(b.user.id,{type:'group',id:group.id});
  const page={html:nativeHtml('<p>Member publication</p>')};
  expect((await create(b.token,page)).status).toBe(403);
  const published=await create(b.token,{...page,visibility:'unlisted'});
  expect(published.status,JSON.stringify(published.body)).toBe(201);
  expect(await owner(published.body.id)).toMatchObject({user_id:null,group_id:group.id,creator_user_id:b.user.id});
  const destination={type:'group',id:group.id};
  expect((await create(b.token,{format:'folder',title:'No folder',destination})).status).toBe(403);
  expect((await create(b.token,{...page,destination,shares:[{email:a.user.email,role:'viewer'}]})).status).toBe(403);
  const child=await createGroup(a.user.id,{handle:'child_group',name:'Child',parent_id:group.id});
  expect((await create(b.token,{...page,destination:{type:'group',id:child.id}})).status).toBe(403);
  await removeGroupMember(a.user.id,group.id,b.user.id);
  expect((await create(b.token,{...page,visibility:'unlisted'})).status).toBe(403);
 });
 it('reserves publication to the company root for admins even when its default is nested',async()=>{
  const a=await account('company-owner'),b=await account('company-member');
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:a.user.email!,AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com',AUTH__INVITE_ONLY:'false'});
  expect(await admitDeploymentIdentity({userId:a.user.id,email:a.user.email!,emailVerified:true})).toBe(true);
  const root=await createGroup(a.user.id,{handle:'company_root',name:'Company root'});
  await setupDeployment(a.user.id,root.id);
  expect(await admitDeploymentIdentity({userId:b.user.id,email:b.user.email!,emailVerified:true})).toBe(true);
  const destination={type:'group' as const,id:root.id};
  const page={html:nativeHtml('<p>Company publication</p>'),visibility:'unlisted'};
  expect((await create(b.token,page)).status).toBe(403);
  const folder=await create(a.token,{format:'folder',title:'Reports',destination});
  expect(folder.status).toBe(201);
  const subgroup=await createGroup(a.user.id,{handle:'nested_default',name:'Nested default',parent_id:root.id});
  await admitGroupMember(a.user.id,subgroup.id,b.user.id,'member');
  await (await getDb()).query("UPDATE deployment_state SET default_group_id=$1 WHERE id='company'",[subgroup.id]);
  expect((await create(b.token,{...page,destination})).status).toBe(403);
  expect((await create(b.token,{...page,parent_id:folder.body.id})).status).toBe(400);
  await setAccountPreferences(b.user.id,destination);
  expect((await create(b.token,page)).status).toBe(403);
  expect(await getGroupDetail(b.user.id,root.id)).toMatchObject({can_publish_pages:false});
  expect(await getGroupDetail(b.user.id,subgroup.id)).toMatchObject({can_publish_pages:true});
  expect((await create(b.token,{...page,destination:{type:'group',id:subgroup.id}})).status).toBe(201);
  expect((await create(a.token,{...page,destination})).status).toBe(201);
  expect((await create(b.token,{...page,destination:{type:'personal'}})).status).toBe(201);
 });
 it('allows a direct member to create within its group folder',async()=>{
  const a=await account('folder-admin'),b=await account('folder-member');
  const group=await createGroup(a.user.id,{handle:'member_folders',name:'Member folders'});
  await admitGroupMember(a.user.id,group.id,b.user.id,'member');
  const folder=await create(a.token,{format:'folder',title:'Reports',visibility:'private',destination:{type:'group',id:group.id}});
  expect(folder.status,JSON.stringify(folder.body)).toBe(201);
  const child=await create(b.token,{html:nativeHtml('<p>Count: 7</p>'),visibility:'private',destination:{type:'group',id:group.id},parent_id:folder.body.id});
  expect(child.status,JSON.stringify(child.body)).toBe(201);
  expect(await owner(child.body.id)).toMatchObject({user_id:null,group_id:group.id,creator_user_id:b.user.id});
  const db=await getDb();
  expect((await db.query('SELECT ancestor_ids FROM artifacts WHERE id=$1',[child.body.id])).rows[0].ancestor_ids).toEqual([folder.body.id]);
 });
});
