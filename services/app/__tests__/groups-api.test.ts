import {DELETE as withdraw} from '@/app/api/groups/[id]/invitations/[invitationId]/route';
import {getGroupRole,acceptGroupInvitations} from '@/lib/groups';
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
  expect((await create(request('/api/groups',{actor,method:'POST',origin:'same',json:{handle:'browser_team',name:'Browser'}}))).status).toBe(201);
  expect((await create(request('/api/groups',{actor,method:'POST',origin:'https://other.test',json:{handle:'cross-site',name:'Cross site'}}))).status).toBe(403);
 });
 it('creates, lists and resolves group handles, protecting private detail and editor writes',async()=>{
  const owner=await mintAccountToken('owner'),viewer=await mintAccountToken('viewer'),outsider=await mintAccountToken('outsider');
  const created=await create(request('/api/groups',{method:'POST',token:owner.token,json:{handle:'api_team',name:'API'}}));expect(created.status).toBe(201);const group=await created.json();
  expect((await (await list(request('/api/groups',{token:owner.token}))).json()).groups).toMatchObject([{id:group.id}]);
  expect((await detail(request('/api/groups/@api_team',{token:owner.token}),context({id:'@api_team'}))).status).toBe(200);
  expect((await detail(request('/api/groups/'+group.id,{token:outsider.token}),context({id:group.id}))).status).toBe(404);
  expect((await member(request('/api/groups/'+group.id+'/members/'+viewer.userId,{method:'PUT',token:owner.token,json:{role:'viewer'}}),context({id:group.id,userId:viewer.userId!}))).status).toBe(404);
  expect((await invite(request('/api/groups/'+group.id+'/invitations',{method:'POST',token:owner.token,json:{email:viewer.email,role:'viewer'}}),context({id:group.id}))).status).toBe(201);
  await acceptGroupInvitations(viewer.userId!,viewer.email!);
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

it('refuses withdrawal of accepted or missing invitations without removing membership',async()=>{
 const owner=await mintAccountToken('withdraw_owner'),invitee=await mintAccountToken('withdraw_member');
 const group=await (await create(request('/api/groups',{method:'POST',token:owner.token,json:{handle:'withdraw_team',name:'Withdrawal'}}))).json();
 const invitation=await (await invite(request('/api/groups/'+group.id+'/invitations',{method:'POST',token:owner.token,json:{email:invitee.email,role:'viewer'}}),context({id:group.id}))).json();
 await acceptGroupInvitations(invitee.userId!,invitee.email!);
 for(const invitationId of [invitation.id,'gin_missing']){
  const response=await withdraw(request('/api/groups/'+group.id+'/invitations/'+invitationId,{method:'DELETE',token:owner.token}),context({id:group.id,invitationId}));
  expect(response.status).toBe(404);expect(await response.json()).toMatchObject({error:'not_found'});
 }
 expect(await getGroupRole(invitee.userId!,group.id)).toBe('viewer');
});

describe('a group\'s page data names its place in the tree and who receives its shares',()=>{
 it('GET /api/groups/{id}: the parent and subgroups with the reader\'s own direct role, direct members only, and the subgroup audience apart',async()=>{
  const admin=await mintAccountToken('tree_admin'),rita=await mintAccountToken('tree_rita'),eve=await mintAccountToken('tree_eve');
  const post=async(body:Record<string,unknown>)=>(await create(request('/api/groups',{method:'POST',token:admin.token,json:body}))).json();
  const finance=await post({handle:'tree_finance',name:'Finance'});
  const retail=await post({handle:'tree_retail',name:'Retail',parent_id:finance.id});
  const outlet=await post({handle:'tree_outlet',name:'Outlet',parent_id:retail.id});
  // Rita is in Retail only; Eve in Outlet only; the admin is a direct member of all three.
  const join=async(group:string,who:{userId:string|null;email:string|null},role:'viewer'|'editor')=>{expect((await invite(request(`/api/groups/${group}/invitations`,{method:'POST',token:admin.token,json:{email:who.email,role}}),context({id:group}))).status).toBe(201);await acceptGroupInvitations(who.userId!,who.email!);};
  await join(retail.id,rita,'viewer');await join(outlet.id,eve,'editor');
  const read=async(token:string,id:string)=>{const response=await detail(request(`/api/groups/${id}`,{token}),context({id}));expect(response.status).toBe(200);return response.json();};
  const top=await read(admin.token,finance.id);
  expect(top.parent).toBeNull();
  expect(top.subgroups).toEqual([{id:retail.id,handle:'tree_retail',name:'Retail',role:'editor'}]);
  expect(top.members.map((m:{user_id:string})=>m.user_id)).toEqual([admin.userId]);
  // Rita and Eve receive Finance's shares through a subgroup without being Finance members.
  expect(top.subgroup_audience).toEqual([
   {user_id:eve.userId,username:null,name:null,via:{id:outlet.id,handle:'tree_outlet',name:'Outlet'}},
   {user_id:rita.userId,username:null,name:null,via:{id:retail.id,handle:'tree_retail',name:'Retail'}},
  ].sort((a,b)=>a.user_id!.localeCompare(b.user_id!)));
  // From Retail, as Rita: its parent (Rita is not a Finance member: no role), its subgroup, and Outlet's Eve.
  const middle=await read(rita.token,retail.id);
  expect(middle.parent).toEqual({id:finance.id,handle:'tree_finance',name:'Finance',role:null});
  expect(middle.subgroups).toEqual([{id:outlet.id,handle:'tree_outlet',name:'Outlet',role:null}]);
  expect(middle.subgroup_audience.map((m:{user_id:string})=>m.user_id)).toEqual([eve.userId]);
  // A leaf has no subgroups and no subgroup audience.
  const leaf=await read(eve.token,outlet.id);
  expect(leaf).toMatchObject({parent:{id:retail.id,role:null},subgroups:[],subgroup_audience:[]});
 });
});
