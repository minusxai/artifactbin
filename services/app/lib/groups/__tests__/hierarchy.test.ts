/**
 * THE GROUP TREE (./hierarchy): subgroups, reparenting and deletion as topology mutations. One parent at most,
 * never a cycle, a revision that moves on every create/delete/reparent and on nothing else, administration that
 * stays on direct rows, and the existing audit trail.
 */
import {describe,it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {createUser} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import * as groups from '..';
import {groupChain,hierarchyRevision} from '../hierarchy';
useAppHarness();
const account=(name:string)=>createUser({email:`mxmx_test_${name}@example.com`});
const revision=async()=>hierarchyRevision(await getDb());
const parentOf=async(id:string)=>(await (await getDb()).query<{parent_id:string|null}>('SELECT parent_id FROM groups WHERE id=$1',[id])).rows[0]?.parent_id;
const audit=async(id:string)=>(await (await getDb()).query<{action:string;details:Record<string,unknown>}>('SELECT action,details FROM group_audit WHERE group_id=$1 ORDER BY created_at,id',[id])).rows;
const join=async(owner:string,group:string,user:{id:string;email:string},role:'viewer'|'editor')=>{await groups.inviteGroupMember(owner,group,user.email,role);await groups.acceptGroupInvitations(user.id,user.email);};
/** Finance ⊃ {Retail, Enterprise}, all administered by `admin`. */
async function tree(){
 const admin=await account('admin');
 const finance=await groups.createGroup(admin.id,{handle:'finance',name:'Finance'});
 const retail=await groups.createGroup(admin.id,{handle:'retail',name:'Retail',parent_id:finance.id});
 const enterprise=await groups.createGroup(admin.id,{handle:'enterprise',name:'Enterprise',parent_id:finance.id});
 return {admin,finance,retail,enterprise};
}

describe('subgroups',()=>{
 it('creates a subgroup only beneath a live group the creator directly edits, and reports its parent',async()=>{
  const {admin,finance,retail}=await tree(),viewer=await account('viewer'),stranger=await account('stranger');
  expect(retail).toMatchObject({parent_id:finance.id,role:'editor'});
  expect(await groupChain(await getDb(),retail.id)).toEqual([retail.id,finance.id]);
  expect((await groups.listGroups(admin.id)).find(g=>g.id===retail.id)?.parent_id).toBe(finance.id);
  expect((await groups.getGroupDetail(admin.id,retail.id))?.group.parent_id).toBe(finance.id);
  await join(admin.id,finance.id,viewer,'viewer');
  await expect(groups.createGroup(viewer.id,{handle:'viewer_sub',name:'No',parent_id:finance.id})).rejects.toMatchObject({code:'forbidden',status:403});
  await expect(groups.createGroup(stranger.id,{handle:'stranger_sub',name:'No',parent_id:finance.id})).rejects.toMatchObject({code:'parent_not_found',status:404});
  await expect(groups.createGroup(admin.id,{handle:'orphan',name:'No',parent_id:'grp_missing'})).rejects.toMatchObject({code:'parent_not_found'});
  // A refused creation reserved nothing and moved no revision.
  const before=await revision();
  await expect(groups.createGroup(viewer.id,{handle:'viewer_sub',name:'No',parent_id:finance.id})).rejects.toMatchObject({code:'forbidden'});
  expect(await revision()).toBe(before);
 });

 it('moves the hierarchy revision on every create, reparent and delete, and never on a membership change',async()=>{
  const r0=await revision();
  const {admin,finance,retail}=await tree();
  const r1=await revision();expect(r1).toBe(r0+3);
  const member=await account('member');await join(admin.id,retail.id,member,'viewer');
  await groups.setGroupMember(admin.id,retail.id,member.id,'editor');await groups.removeGroupMember(admin.id,retail.id,member.id);
  expect(await revision()).toBe(r1);
  expect(await groups.setGroupParent(admin.id,retail.id,null)).toMatchObject({changed:true,parent_id:null,hierarchy_revision:r1+1});
  expect(await revision()).toBe(r1+1);
  // An unchanged parent moves nothing.
  expect(await groups.setGroupParent(admin.id,retail.id,null)).toEqual({changed:false,parent_id:null});
  expect(await revision()).toBe(r1+1);
  await groups.setGroupParent(admin.id,retail.id,finance.id);
  expect(await revision()).toBe(r1+2);
  await groups.setGroupParent(admin.id,retail.id,null,finance.id);
  await groups.deleteGroup(admin.id,retail.id,'retail');
  expect(await revision()).toBe(r1+4);
 });

 it('refuses a cycle: the group itself or any of its descendants as its parent',async()=>{
  const {admin,finance,retail}=await tree();
  const store=await groups.createGroup(admin.id,{handle:'store',name:'Store',parent_id:retail.id});
  const before=await revision();
  await expect(groups.setGroupParent(admin.id,finance.id,finance.id)).rejects.toMatchObject({code:'hierarchy_cycle',status:409});
  await expect(groups.setGroupParent(admin.id,finance.id,store.id)).rejects.toMatchObject({code:'hierarchy_cycle',status:409});
  await expect(groups.setGroupParent(admin.id,retail.id,store.id,finance.id)).rejects.toMatchObject({code:'hierarchy_cycle'});
  expect([await parentOf(finance.id),await parentOf(retail.id),await parentOf(store.id)]).toEqual([null,finance.id,retail.id]);
  expect(await revision()).toBe(before);
 });

 it('refuses a second parent across trees unless the move names the current one, and a stale one',async()=>{
  const {admin,finance,retail}=await tree();
  const operations=await groups.createGroup(admin.id,{handle:'operations',name:'Operations'});
  await expect(groups.setGroupParent(admin.id,retail.id,operations.id)).rejects.toMatchObject({code:'already_has_parent',status:409});
  await expect(groups.setGroupParent(admin.id,retail.id,operations.id,null)).rejects.toMatchObject({code:'parent_changed',status:409});
  expect(await parentOf(retail.id)).toBe(finance.id);
  expect(await groups.setGroupParent(admin.id,retail.id,operations.id,finance.id)).toMatchObject({changed:true,parent_id:operations.id});
  expect(await groupChain(await getDb(),retail.id)).toEqual([retail.id,operations.id]);
  expect((await audit(retail.id)).at(-1)).toEqual({action:'reparented',details:{previous_parent_id:finance.id,parent_id:operations.id}});
  expect((await audit(finance.id)).map(row=>row.action)).toContain('subgroup_detached');
  expect((await audit(operations.id)).map(row=>row.action)).toContain('subgroup_attached');
 });

 it('needs a direct editor of the moved group, its current parent and its new one; ancestry grants none of it',async()=>{
  const {admin,finance,retail}=await tree(),lead=await account('lead');
  // An editor of Retail and a viewer of Finance: Retail's administrator cannot lift it out of Finance.
  await join(admin.id,retail.id,lead,'editor');await join(admin.id,finance.id,lead,'viewer');
  await expect(groups.setGroupParent(lead.id,retail.id,null)).rejects.toMatchObject({code:'forbidden',status:403});
  const own=await groups.createGroup(lead.id,{handle:'lead_team',name:'Lead team'});
  await expect(groups.setGroupParent(lead.id,own.id,finance.id)).rejects.toMatchObject({code:'forbidden'});
  // Finance's editor administers neither Retail nor its membership by ancestry.
  const head=await account('head');await join(admin.id,finance.id,head,'editor');
  await expect(groups.setGroupParent(head.id,retail.id,null)).rejects.toMatchObject({code:'not_found',status:404});
  await expect(groups.updateGroup(head.id,retail.id,{name:'Mine'})).rejects.toMatchObject({code:'not_found'});
  expect(await groups.getGroupRole(head.id,retail.id)).toBeNull();
  expect(await parentOf(retail.id)).toBe(finance.id);
 });

 it('refuses to delete a group with live subgroups; once they are gone it deletes',async()=>{
  const {admin,finance,retail,enterprise}=await tree();
  await expect(groups.deleteGroup(admin.id,finance.id,'finance')).rejects.toMatchObject({code:'group_has_children',status:409});
  await groups.deleteGroup(admin.id,retail.id,'retail');
  await groups.setGroupParent(admin.id,enterprise.id,null,finance.id);
  await groups.deleteGroup(admin.id,finance.id,'finance');
  expect(await groups.getGroupById(finance.id)).toBeNull();
  expect(await parentOf(enterprise.id)).toBeNull();
 });
});
