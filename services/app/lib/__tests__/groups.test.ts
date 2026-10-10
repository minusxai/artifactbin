import {describe,it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {createUser,setUsername} from '@/lib/accounts';
import {getDb} from '@/lib/platform/db';
import {createGroup,getGroupDetail,getGroupRole,setGroupMember,removeGroupMember,getAccountPreferences,setAccountPreferences} from '../groups';
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
});
