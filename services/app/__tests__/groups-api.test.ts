import {describe,it,expect} from 'vitest';
import {useAppHarness,request,mintAccountToken} from './harness';
import {POST as create,GET as list} from '@/app/api/groups/route';
import {GET as detail} from '@/app/api/groups/[id]/route';
import {POST as invite} from '@/app/api/groups/[id]/invitations/route';
import {PUT as member} from '@/app/api/groups/[id]/members/[userId]/route';
import {GET as preferences,PUT as savePreferences} from '@/app/api/me/preferences/route';
useAppHarness();
const context=(params:Record<string,string>)=>({params:Promise.resolve(params)});
describe('groups authenticated HTTP boundary',()=>{
 it('serves verified browser sessions without an API token and refuses cross-site mutations',async()=>{
  const owner=await mintAccountToken('browser_owner');
  const actor={credential:'session' as const,userId:owner.userId!,email:'mxmx_test_browser_owner@example.com',emailVerified:true};
  expect((await list(request('/api/groups',{actor}))).status).toBe(200);
  for(const authorization of ['Basic anything','Bearer ','']){
   expect((await list(request('/api/groups',{actor:{...actor,tokenId:owner.id},headers:{authorization}}))).status).toBe(401);
   expect((await create(request('/api/groups',{actor:{...actor,tokenId:owner.id},method:'POST',origin:'same',headers:{authorization},json:{handle:'invalid-header',name:'Refused'}}))).status).toBe(401);
  }
  expect((await create(request('/api/groups',{actor,method:'POST',origin:'same',json:{handle:'browser-team',name:'Browser'}}))).status).toBe(201);
  expect((await create(request('/api/groups',{actor,method:'POST',origin:'https://other.test',json:{handle:'cross-site',name:'Cross site'}}))).status).toBe(403);
 });
 it('creates, lists and resolves group handles, protecting private detail and editor writes',async()=>{
  const owner=await mintAccountToken('owner'),viewer=await mintAccountToken('viewer'),outsider=await mintAccountToken('outsider');
  const created=await create(request('/api/groups',{method:'POST',token:owner.token,json:{handle:'api-team',name:'API'}}));expect(created.status).toBe(201);const group=await created.json();
  expect((await (await list(request('/api/groups',{token:owner.token}))).json()).groups).toMatchObject([{id:group.id}]);
  expect((await detail(request('/api/groups/@api-team',{token:owner.token}),context({id:'@api-team'}))).status).toBe(200);
  expect((await detail(request('/api/groups/'+group.id,{token:outsider.token}),context({id:group.id}))).status).toBe(404);
  expect((await member(request('/api/groups/'+group.id+'/members/'+viewer.userId,{method:'PUT',token:owner.token,json:{role:'viewer'}}),context({id:group.id,userId:viewer.userId!}))).status).toBe(200);
  expect((await invite(request('/api/groups/'+group.id+'/invitations',{method:'POST',token:viewer.token,json:{email:'mxmx_test_new@example.com',role:'editor'}}),context({id:group.id}))).status).toBe(403);
  const viewed=await (await detail(request('/api/groups/'+group.id,{token:viewer.token}),context({id:group.id}))).json();expect(viewed.invitations).toBeUndefined();expect(viewed.members[0]).not.toHaveProperty('email');
 });
 it('validates preference membership and invalid JSON destinations',async()=>{
  const owner=await mintAccountToken('owner');expect(await (await preferences(request('/api/me/preferences',{token:owner.token}))).json()).toEqual({default_destination:{type:'inherit'}});
  expect((await savePreferences(request('/api/me/preferences',{method:'PUT',token:owner.token,json:{default_destination:{type:'group',id:'missing'}}}))).status).toBe(403);
  expect((await savePreferences(request('/api/me/preferences',{method:'PUT',token:owner.token,json:{}}))).status).toBe(400);
  expect(await (await savePreferences(request('/api/me/preferences',{method:'PUT',token:owner.token,json:{default_destination:{type:'personal'}}}))).json()).toEqual({default_destination:{type:'personal'}});
 });
});
