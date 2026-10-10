import {describe,expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {createUser} from '@/lib/accounts';
import {createGroup,setGroupMember,removeGroupMember,setAccountPreferences} from '@/lib/groups';
import {getDb} from '@/lib/platform/db';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as start} from '@/app/api/start/route';
useAppHarness();
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
  const a=await account('starter');const group=await createGroup(a.user.id,{handle:'starter-group',name:'Starter group'});
  await setAccountPreferences(a.user.id,{type:'group',id:group.id});
  const grouped=await start(request('/api/start',{method:'POST',token:a.token}));
  expect(grouped.status).toBe(201);expect(await owner((await grouped.json()).id)).toMatchObject({group_id:group.id});
  const personal=await start(request('/api/start',{method:'POST',token:a.token,json:{destination:{type:'personal'}}}));
  expect(personal.status).toBe(201);expect(await owner((await personal.json()).id)).toMatchObject({group_id:null,user_id:a.user.id});
 });
 it('applies the saved group to new documents and permits explicit personal publication',async()=>{
  const a=await account('owner');const group=await createGroup(a.user.id,{handle:'publishing',name:'Publishing'});
  await setAccountPreferences(a.user.id,{type:'group',id:group.id});
  const grouped=await create(a.token,{markup:'<p id="intro">Group content</p>'});
  expect(grouped.status,JSON.stringify(grouped.body)).toBe(201);
  expect(await owner(grouped.body.id)).toMatchObject({user_id:null,group_id:group.id,creator_user_id:a.user.id});
  const personal=await create(a.token,{markup:'<p id="intro">Personal content</p>',destination:{type:'personal'}});
  expect(personal.status,JSON.stringify(personal.body)).toBe(201);
  expect(await owner(personal.body.id)).toMatchObject({user_id:a.user.id,group_id:null,creator_user_id:a.user.id});
 });
 it('uses parent ownership before the saved preference and refuses conflicting explicit ownership',async()=>{
  const a=await account('owner');const group=await createGroup(a.user.id,{handle:'publishing',name:'Publishing'});
  const folder=await create(a.token,{format:'folder',title:'Personal folder'});expect(folder.status).toBe(201);
  await setAccountPreferences(a.user.id,{type:'group',id:group.id});
  const child=await create(a.token,{markup:'<p id="intro">Child</p>',parent_id:folder.body.id});
  expect(child.status,JSON.stringify(child.body)).toBe(201);
  expect(await owner(child.body.id)).toMatchObject({user_id:a.user.id,group_id:null});
  const conflict=await create(a.token,{markup:'<p id="intro">Wrong owner</p>',parent_id:folder.body.id,destination:{type:'group',id:group.id}});
  expect(conflict.status).toBeGreaterThanOrEqual(400);expect(conflict.status).toBeLessThan(500);
 });
 it('lets viewers choose a default but refuses publication and never falls back after membership removal',async()=>{
  const a=await account('owner'),b=await account('member');const group=await createGroup(a.user.id,{handle:'publishing',name:'Publishing'});
  await setGroupMember(a.user.id,group.id,b.user.id,'viewer');
  await setAccountPreferences(b.user.id,{type:'group',id:group.id});
  const denied=await create(b.token,{markup:'<p id="intro">Viewer cannot publish</p>'});
  expect(denied.status).toBeGreaterThanOrEqual(400);expect(denied.status).toBeLessThan(500);
  await removeGroupMember(a.user.id,group.id,b.user.id);
  const unavailable=await create(b.token,{markup:'<p id="intro">No silent personal fallback</p>'});
  expect(unavailable.status).toBeGreaterThanOrEqual(400);expect(unavailable.status).toBeLessThan(500);
  const db=await getDb();expect((await db.query('SELECT id FROM artifacts WHERE user_id=$1 OR creator_user_id=$1',[b.user.id])).rows).toEqual([]);
 });
});
