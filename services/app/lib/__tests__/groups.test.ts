import {describe,it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {createUser,setUsername} from '@/lib/accounts';
import {getDb} from '@/lib/platform/db';
import {createGroup,getGroupDetail,getGroupRole,setGroupMember,removeGroupMember,getAccountPreferences,setAccountPreferences,inviteGroupMember,acceptGroupInvitations,setGroupLink} from '../groups';
useAppHarness();
const account=async(name:string)=>createUser({email:`mxmx_test_${name}@example.com`});
describe('independent group owner contracts',()=>{
 it('creates a group and its first editor without inventing an account or artifact',async()=>{
  const owner=await account('owner');const group=await createGroup(owner.id,{handle:'acme-team',name:'Acme'});
  expect(group).toMatchObject({handle:'acme-team',name:'Acme',role:'editor'});
  expect(await getGroupRole(owner.id,group.id)).toBe('editor');
  const db=await getDb();
  expect((await db.query('SELECT id FROM users WHERE id=$1',[group.id])).rows).toEqual([]);
  expect((await db.query('SELECT id FROM artifacts WHERE id=$1',[group.id])).rows).toEqual([]);
 });
 it('permits editor member management, refuses viewers and protects the last editor',async()=>{
  const owner=await account('owner'),viewer=await account('viewer'),other=await account('other');
  const group=await createGroup(owner.id,{handle:'acme',name:'Acme'});
  await setGroupMember(owner.id,group.id,viewer.id,'viewer');
  await expect(setGroupMember(viewer.id,group.id,other.id,'editor')).rejects.toThrow();
  await expect(removeGroupMember(owner.id,group.id,owner.id)).rejects.toThrow();
  await expect(setGroupMember(owner.id,group.id,owner.id,'viewer')).rejects.toThrow();
  await setGroupMember(owner.id,group.id,other.id,'editor');
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
  await setGroupMember(owner.id,group.id,member.id,'viewer');
  await setAccountPreferences(member.id,{type:'group',id:group.id});
  await removeGroupMember(owner.id,group.id,member.id);
  expect(await getAccountPreferences(member.id)).toEqual({default_destination:{type:'group',id:group.id}});
  expect(await setAccountPreferences(member.id,{type:'personal'})).toEqual({default_destination:{type:'personal'}});
 });
 it('serializes competing last-editor removals',async()=>{
  const first=await account('first'),second=await account('second');const group=await createGroup(first.id,{handle:'race-team',name:'Race'});
  await setGroupMember(first.id,group.id,second.id,'editor');
  const results=await Promise.allSettled([removeGroupMember(first.id,group.id,first.id),removeGroupMember(second.id,group.id,second.id)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const db=await getDb();expect(Number((await db.query<{count:string}>("SELECT count(*) FROM group_members WHERE group_id=$1 AND role='editor'",[group.id])).rows[0].count)).toBe(1);
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
  const owner=await account('owner'),invited=await account('invited'),outsider=await account('outsider');const group=await createGroup(owner.id,{handle:'invite-team',name:'Invites'});
  await inviteGroupMember(owner.id,group.id,invited.email,'viewer');
  expect(await getGroupDetail(outsider.id,group.id)).toBeNull();
  await expect(acceptGroupInvitations(outsider.id,invited.email)).rejects.toThrow('verified_email_mismatch');
  const db=await getDb();expect(await db.transaction(tx=>acceptGroupInvitations(invited.id,invited.email,tx))).toEqual([group.id]);
  expect(await getGroupRole(invited.id,group.id)).toBe('viewer');
  expect((await getGroupDetail(invited.id,group.id))?.invitations).toBeUndefined();
  expect((await getGroupDetail(owner.id,group.id))?.invitations).toEqual([]);
 });
 it('links groups for navigation without inheriting membership',async()=>{
  const owner=await account('owner'),viewer=await account('viewer');const first=await createGroup(owner.id,{handle:'first-team',name:'First'}),second=await createGroup(owner.id,{handle:'second-team',name:'Second'});
  await setGroupMember(owner.id,first.id,viewer.id,'viewer');await setGroupLink(owner.id,first.id,second.id,true);
  expect((await getGroupDetail(viewer.id,first.id))?.linked_groups).toMatchObject([{id:second.id,role:null}]);
  expect(await getGroupRole(viewer.id,second.id)).toBeNull();expect(await getGroupDetail(viewer.id,second.id)).toBeNull();
 });

});
