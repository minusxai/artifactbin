import {admitGroupMember} from '@/__tests__/harness';
import {describe,it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import { createUser, setUsername } from '@/lib/accounts';
import {overrideConfig,resetConfigOverrides} from '@/lib/platform/config';
import {getDb} from '@/lib/platform/db';
import {createGroup,getGroupDetail,searchGroupMembers,getGroupRole,setGroupMember,removeGroupMember,getAccountPreferences,setAccountPreferences,inviteGroupMember,acceptGroupInvitations,setGroupLink} from '..';
useAppHarness();
const account=async(name:string)=>createUser({email:`mxmx_test_${name}@example.com`});
describe('independent group owner contracts',()=>{
 it('uses the same handle rules for users and groups after case and trim normalization',async()=>{
  const owner=await account('rules');
  for(const handle of ['a-b','_ab','ab_','___','ab','a'.repeat(33)]){
   expect(await setUsername(owner.id,handle),handle).toEqual({error:'invalid'});
   await expect(createGroup(owner.id,{handle,name:'Rules'}),handle).rejects.toMatchObject({code:'invalid_group'});
  }
  for(const handle of ['a_b','abc','a1'.repeat(16)]){
   expect(await setUsername(owner.id,`  ${handle.toUpperCase()} `)).toEqual({ok:true,username:handle});
   await expect(createGroup(owner.id,{handle,name:'Taken'})).rejects.toMatchObject({code:'handle_taken'});
   expect(await setUsername(owner.id,'released')).toEqual({ok:true,username:'released'});
   expect(await createGroup(owner.id,{handle:`  ${handle.toUpperCase()} `,name:'Rules'})).toMatchObject({handle});
   expect(await setUsername(owner.id,handle)).toEqual({error:'taken'});
  }
 });
 it('creates a group and its first admin without inventing an account or artifact',async()=>{
  const owner=await account('owner');const group=await createGroup(owner.id,{handle:'acme_team',name:'Acme'});
  expect(group).toMatchObject({handle:'acme_team',name:'Acme',role:'admin'});
  expect(await getGroupRole(owner.id,group.id)).toBe('admin');
  const db=await getDb();
  expect((await db.query('SELECT id FROM users WHERE id=$1',[group.id])).rows).toEqual([]);
  expect((await db.query('SELECT id FROM artifacts WHERE id=$1',[group.id])).rows).toEqual([]);
 });
 it('permits editor member management, refuses viewers and protects the last admin',async()=>{
  const owner=await account('owner'),viewer=await account('member'),other=await account('other');
  const group=await createGroup(owner.id,{handle:'acme',name:'Acme'});
  await admitGroupMember(owner.id,group.id,viewer.id,'member');
  await expect(setGroupMember(viewer.id,group.id,other.id,'admin')).rejects.toMatchObject({code:'forbidden'});
  await expect(removeGroupMember(owner.id,group.id,owner.id)).rejects.toMatchObject({code:'last_admin'});
  await expect(setGroupMember(owner.id,group.id,owner.id,'member')).rejects.toMatchObject({code:'last_admin'});
  await admitGroupMember(owner.id,group.id,other.id,'admin');
  await removeGroupMember(other.id,group.id,owner.id);
  expect(await getGroupRole(owner.id,group.id)).toBeNull();
  expect((await getGroupDetail(other.id,group.id))?.group.id).toBe(group.id);
 });
 it('reserves a single shared user/group handle namespace',async()=>{
  const owner=await account('owner');await setUsername(owner.id,'acme');
  await expect(createGroup(owner.id,{handle:'acme',name:'Taken'})).rejects.toThrow();
  await createGroup(owner.id,{handle:'design',name:'Design'});
  expect(await setUsername(owner.id,'design')).toEqual({error:'taken'});
 });
 it('shares stable default preferences and preserves an inaccessible saved group for explicit recovery',async()=>{
  const owner=await account('owner'),member=await account('member');const group=await createGroup(owner.id,{handle:'acme',name:'Acme'});
  expect(await getAccountPreferences(member.id)).toEqual({default_destination:{type:'inherit'}});
  await expect(setAccountPreferences(member.id,{type:'group',id:group.id})).rejects.toThrow();
  await admitGroupMember(owner.id,group.id,member.id,'member');
  await setAccountPreferences(member.id,{type:'group',id:group.id});
  await removeGroupMember(owner.id,group.id,member.id);
  expect(await getAccountPreferences(member.id)).toEqual({default_destination:{type:'group',id:group.id}});
  expect(await setAccountPreferences(member.id,{type:'personal'})).toEqual({default_destination:{type:'personal'}});
 });
 it('serializes competing last-admin removals',async()=>{
  const first=await account('first'),second=await account('second');const group=await createGroup(first.id,{handle:'race_team',name:'Race'});
  await admitGroupMember(first.id,group.id,second.id,'admin');
  const results=await Promise.allSettled([removeGroupMember(first.id,group.id,first.id),removeGroupMember(second.id,group.id,second.id)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const db=await getDb();expect(Number((await db.query<{count:string}>("SELECT count(*) FROM group_members WHERE group_id=$1 AND role='admin'",[group.id])).rows[0].count)).toBe(1);
 });
 it('claims shared handles atomically against simultaneous account and group writes and legacy handles',async()=>{
  const owner=await account('owner'),other=await account('other');
  const results=await Promise.allSettled([createGroup(owner.id,{handle:'collision',name:'Race'}),setUsername(other.id,'collision')]);
  const groupWon=results[0].status==='fulfilled';
  expect(results[1].status).toBe('fulfilled');
  expect(results[1].status==='fulfilled'?results[1].value:null).toEqual(groupWon?{error:'taken'}:{ok:true,username:'collision'});
  const db=await getDb();await db.query("UPDATE users SET username='legacy' WHERE id=$1",[owner.id]);
  await expect(createGroup(owner.id,{handle:'legacy',name:'Legacy'})).rejects.toThrow('handle_taken');
 });
 it('accepts only verified account invitations, preserves roles, and exposes no members to outsiders',async()=>{
  const owner=await account('owner'),invited=await account('invited'),outsider=await account('outsider');const group=await createGroup(owner.id,{handle:'invite_team',name:'Invites'});
  await inviteGroupMember(owner.id,group.id,invited.email,'member');
  expect(await getGroupDetail(outsider.id,group.id)).toBeNull();
  await expect(acceptGroupInvitations(outsider.id,invited.email)).rejects.toThrow('verified_email_mismatch');
  expect(await acceptGroupInvitations(invited.id,invited.email)).toEqual([group.id]);
  expect(await getGroupRole(invited.id,group.id)).toBe('member');
  expect((await getGroupDetail(invited.id,group.id))?.invitations).toBeUndefined();
  expect((await getGroupDetail(owner.id,group.id))?.invitations).toEqual([]);
 });
 it('limits the member directory to the active group, and to admins in the company root',async({onTestFinished})=>{
  onTestFinished(resetConfigOverrides);
  const owner=await account('owner'), member=await account('member'), peer=await account('peer');
  const root=await createGroup(owner.id,{handle:'org_root',name:'Organization'});
  const team=await createGroup(owner.id,{handle:'org_team',name:'Team',parent_id:root.id});
  const leaf=await createGroup(owner.id,{handle:'org_leaf',name:'Leaf',parent_id:team.id});
  const other=await createGroup(owner.id,{handle:'other_root',name:'Other'});
  for(const g of [root,team,other]) await admitGroupMember(owner.id,g.id,member.id,'member');
  await admitGroupMember(owner.id,root.id,peer.id,'member');
  await setGroupLink(owner.id,team.id,leaf.id,true);
  await setGroupLink(owner.id,root.id,other.id,true);
  const db=await getDb();
  await db.query(`WITH added AS (
   INSERT INTO users(id,email) SELECT 'usr_dir_'||n,'mxmx_test_dir_'||n||'@example.com' FROM generate_series(1,101) n RETURNING id
  ) INSERT INTO group_members(group_id,user_id,role) SELECT $1,id,'member' FROM added`,[team.id]);
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:owner.email!});
  await db.query("INSERT INTO deployment_state(id,default_group_id,setup_complete) VALUES ('company',$1,true) ON CONFLICT(id) DO UPDATE SET default_group_id=excluded.default_group_id,setup_complete=true",[team.id]);
  const directory=await getGroupDetail(member.id,root.id);
  expect(directory?.members.map(m=>m.user_id)).toEqual([owner.id]);
  expect(directory).toMatchObject({subgroups:[],subgroup_audience:[],linked_groups:[]});
  expect(await searchGroupMembers(member.id,root.id,peer.id)).toEqual([]);
  const own=await getGroupDetail(member.id,team.id);
  expect(own).toMatchObject({subgroups:[],subgroup_audience:[],linked_groups:[]});
  expect(own?.members).toHaveLength(103);
  expect((await getGroupDetail(member.id,other.id))?.members).toHaveLength(2);
  expect((await getGroupDetail(owner.id,root.id))?.members).toHaveLength(3);
  expect((await searchGroupMembers(owner.id,root.id,peer.id)).map(m=>m.user_id)).toEqual([peer.id]);
 });
 it('links groups for navigation without inheriting membership',async()=>{
  const owner=await account('owner'),viewer=await account('member');const first=await createGroup(owner.id,{handle:'first_team',name:'First'}),second=await createGroup(owner.id,{handle:'second_team',name:'Second'});
  await admitGroupMember(owner.id,first.id,viewer.id,'member');await setGroupLink(owner.id,first.id,second.id,true);
  expect((await getGroupDetail(viewer.id,first.id))?.linked_groups).toMatchObject([{id:second.id,role:null}]);
  expect(await getGroupRole(viewer.id,second.id)).toBeNull();expect(await getGroupDetail(viewer.id,second.id)).toBeNull();
 });

});
