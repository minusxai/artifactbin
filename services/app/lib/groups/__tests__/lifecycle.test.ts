import {transferArtifact} from '@/lib/artifacts';
import {getDb} from '@/lib/platform';
import {identityForUser} from '@/lib/accounts';
import {mine} from '@/__tests__/artifact-fixtures';
import {trashArtifactFor,restoreArtifactFor} from '@/lib/workspace';
import {describe,it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {createUser} from '@/lib/accounts';
import * as groups from '..';
useAppHarness();
const account=(name:string)=>createUser({email:`mxmx_test_${name}@example.com`});
describe('group lifecycle contracts',()=>{
 it('role PUT cannot add a member; a verified invite admits them and a viewer may leave',async()=>{
  const owner=await account('owner'),member=await account('member');
  const group=await groups.createGroup(owner.id,{handle:'design_crit',name:'Design'});
  await expect(groups.setGroupMember(owner.id,group.id,member.id,'viewer')).rejects.toMatchObject({code:'not_member',status:404});
  const first=await groups.inviteGroupMember(owner.id,group.id,member.email,'viewer');
  const again=await groups.inviteGroupMember(owner.id,group.id,member.email,'viewer');
  expect(first).toMatchObject({changed:true,invited_by:owner.id});
  expect(again).toMatchObject({id:first.id,changed:false});
  await groups.acceptGroupInvitations(member.id,member.email);
  await groups.removeGroupMember(member.id,group.id,member.id);
  expect(await groups.getGroupRole(member.id,group.id)).toBeNull();
 });
});

it('updates presentation, protects default/nonempty groups, retains handle tombstones and clears references',async()=>{
 const owner=await account('owner'),viewer=await account('viewer');const group=await groups.createGroup(owner.id,{handle:'design_crit',name:'Design'});
 await groups.inviteGroupMember(owner.id,group.id,viewer.email,'viewer');await groups.acceptGroupInvitations(viewer.id,viewer.email);
 await expect(groups.updateGroup(viewer.id,group.id,{name:'No'})).rejects.toMatchObject({code:'forbidden'});
 await expect(groups.updateGroup(owner.id,group.id,{handle:'new'} as never)).rejects.toMatchObject({code:'invalid_group'});
 expect(await groups.updateGroup(owner.id,group.id,{description:'  Review  '})).toMatchObject({name:'Design',description:'Review'});
 await expect(groups.deleteGroup(owner.id,group.id,'wrong')).rejects.toMatchObject({code:'handle_mismatch'});
 const db=await getDb();await db.query("INSERT INTO deployment_state(id,default_group_id) VALUES('deployment',$1)",[group.id]);
 await expect(groups.deleteGroup(owner.id,group.id,group.handle)).rejects.toMatchObject({code:'default_group_locked'});
 await db.query('DELETE FROM deployment_state');
 const actor=identityForUser(owner.id,null);
 const page=await mine({...actor,userId:owner.id},'Team',{destination:{type:'group',id:group.id}});
 await expect(groups.deleteGroup(owner.id,group.id,group.handle)).rejects.toMatchObject({code:'group_not_empty'});
 await trashArtifactFor(actor,page.id);await groups.setAccountPreferences(viewer.id,{type:'group',id:group.id});
 await groups.deleteGroup(owner.id,group.id,group.handle);
 expect(await groups.getGroupById(group.id)).toBeNull();
 expect(await groups.getAccountPreferences(viewer.id)).toEqual({default_destination:{type:'inherit'}});
 expect(await restoreArtifactFor({...actor,groupId:group.id},page.id)).toBeNull();
 await expect(groups.createGroup(owner.id,{handle:group.handle,name:'Reclaim'})).rejects.toMatchObject({code:'handle_taken'});
});

it('serializes deletion versus publishing and moving owned work',async()=>{
 const owner=await account('race_owner');const actor={...identityForUser(owner.id,null),userId:owner.id};
 const group=await groups.createGroup(owner.id,{handle:'publish_race',name:'Publish'});
 const results=await Promise.allSettled([groups.deleteGroup(owner.id,group.id,group.handle),mine(actor,'New',{destination:{type:'group',id:group.id}})]);
 const db=await getDb();
 const live=(await db.query('SELECT id FROM artifacts WHERE group_id=$1 AND deleted_at IS NULL',[group.id])).rows;
 expect(live.length===0||await groups.getGroupById(group.id)!==null).toBe(true);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const second=await groups.createGroup(owner.id,{handle:'transfer_race',name:'Transfer'});const page=await mine(actor);
 await Promise.allSettled([groups.deleteGroup(owner.id,second.id,second.handle),transferArtifact(actor,page.id,{type:'group',id:second.id})]);
 const row=(await db.query<{group_id:string|null}>('SELECT group_id FROM artifacts WHERE id=$1',[page.id])).rows[0];
 expect(row.group_id===null||await groups.getGroupById(row.group_id)!==null).toBe(true);
});
