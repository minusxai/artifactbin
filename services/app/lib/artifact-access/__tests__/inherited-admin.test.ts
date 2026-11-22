/**
 * ADMINISTRATION FLOWS DOWN THE GROUP TREE: Root ⊃ Mid ⊃ Leaf. An admin of Root is an EFFECTIVE ADMIN of Mid and Leaf
 * (identity's `group_admins` view): everything a direct admin of Leaf may do (members, invitations, settings, subgroups,
 * moves, deletion, ownership of Leaf-owned work and its sharing) and everything an editor or member there may do. An
 * Editor or Member of Root gains nothing below it. An inherited admin is never a member of Leaf (not listed, not mailed,
 * not counted as its last admin), and losing the Root role ends the authority at once. Every decision source agrees:
 * the JavaScript rule over live, preloaded and transaction facts, `readThrough`, and the SQL scopes.
 */
import {describe,expect,it} from 'vitest';
import {useAppHarness,admitGroupMember,request,params} from '@/__tests__/harness';
import {account,mine,head,sql,dataset,type Account} from '@/__tests__/artifact-fixtures';
import {createGroup,deleteGroup,getGroupDetail,inviteGroupMember,removeGroupInvitation,removeGroupMember,searchGroupMembers,setGroupLink,setGroupMember,setGroupParent,updateGroup} from '@/lib/groups';
import {setArtifactGroupShare,transferArtifact,updateSharingFor,listArtifactPageFor} from '@/lib/artifacts';
import {trashArtifactFor} from '@/lib/workspace';
import {datasetWriteAccess} from '@/lib/dataset-permissions';
import {getDb} from '@/lib/platform';
import {GET as groupRoute} from '@/app/api/groups/[id]/route';
import {shareRolesAtLeast, type ArtifactRole} from '@artifactbin/contracts/sharing';
import {effectiveRole,liveAccessFacts,preloadAccessFacts,transactionAccessFacts,readThrough,annotationScope,editorScope,ownerScope,commentMonitorScope,policyReaderSql,type Scope} from '..';
useAppHarness();

const admitted=async(scope:Scope,id:string)=>(await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[id,scope.val])).length===1;
const reaches=(role:ArtifactRole,min:ArtifactRole)=>role==='owner'||(min!=='owner'&&shareRolesAtLeast(min).includes(role as never));
/** The one role every source gives `actor` on `id`, after asserting they all agree with it. */
async function roleOf(id:string,actor:Account):Promise<ArtifactRole>{
 const db=await getDb(),row=await head(id);
 const live=await effectiveRole(row,actor,liveAccessFacts(actor));
 expect(await effectiveRole(row,actor,await preloadAccessFacts(db,actor,[row])),'preloaded').toBe(live);
 expect(await db.transaction(tx=>effectiveRole(row,actor,transactionAccessFacts(actor,tx))),'transaction').toBe(live);
 const read=live!=='none';
 expect(await readThrough(db,row,actor),'readThrough').toBe(read);
 expect((await sql(`SELECT id FROM artifacts WHERE id=$1 AND ${policyReaderSql('$2','$3')}`,[id,actor.userId,null])).length===1,'sql policy reader').toBe(read);
 expect(await admitted(commentMonitorScope(actor),id),'sql comment monitor').toBe(read);
 expect(await admitted(annotationScope(actor),id),'sql commenter').toBe(reaches(live,'commenter'));
 expect(await admitted(editorScope(actor),id),'sql editor').toBe(reaches(live,'editor'));
 expect(await admitted(ownerScope(actor),id),'sql owner').toBe(live==='owner');
 expect((await listArtifactPageFor(actor,100)).rows.some(r=>r.id===id),'listing').toBe(read);
 return live;
}
/**
 * Root ⊃ Mid ⊃ Leaf. The founder created all three (a direct admin of Root and Mid) and left Leaf; Ann administers Root,
 * Ed edits Root and Meg is a member of it; Lee is Leaf's only direct admin and Mia a member of Leaf.
 */
async function tree(){
 const founder=await account('mxmx_test_founder@example.com'),ann=await account('mxmx_test_ann@example.com'),ed=await account('mxmx_test_ed@example.com');
 const meg=await account('mxmx_test_meg@example.com'),lee=await account('mxmx_test_lee@example.com'),mia=await account('mxmx_test_mia@example.com');
 const root=await createGroup(founder.userId,{handle:'root_team',name:'Root'});
 const mid=await createGroup(founder.userId,{handle:'mid_team',name:'Mid',parent_id:root.id});
 const leaf=await createGroup(founder.userId,{handle:'leaf_team',name:'Leaf',parent_id:mid.id});
 await admitGroupMember(founder.userId,root.id,ann.userId,'admin');
 await admitGroupMember(founder.userId,root.id,ed.userId,'member');
 await admitGroupMember(founder.userId,root.id,meg.userId,'member');
 await admitGroupMember(founder.userId,leaf.id,lee.userId,'admin');
 await admitGroupMember(founder.userId,leaf.id,mia.userId,'member');
 await removeGroupMember(founder.userId,leaf.id,founder.userId);
 return {founder,ann,ed,meg,lee,mia,root,mid,leaf};
}
const refused=(promise:Promise<unknown>,code:string)=>expect(promise).rejects.toMatchObject({code});

describe('an admin of a parent administers its subgroups without being their member',()=>{
 it('manages a grandchild: members, invitations, settings, links, subgroups and its place in the tree, audited as the actor',async()=>{
  const t=await tree();
  const detail=(await getGroupDetail(t.ann.userId,t.leaf.id))!;
  expect(detail.group.role).toBe('admin');
  expect(detail.admin_via).toEqual({id:t.root.id,handle:'root_team',name:'Root'});
  expect(detail.invitations).toEqual([]);
  // Not a member: the members are Leaf's own rows, as everyone sees them.
  expect(detail.members.map(member=>member.user_id).sort()).toEqual([t.lee.userId,t.mia.userId].sort());
  expect((await searchGroupMembers(t.ann.userId,t.leaf.id,'')).map(member=>member.user_id).sort()).toEqual([t.lee.userId,t.mia.userId].sort());
  // A direct admin's detail names no inherited authority; nor does the founder's, an admin of Leaf through Mid.
  expect((await getGroupDetail(t.lee.userId,t.leaf.id))!).not.toHaveProperty('admin_via');
  expect((await getGroupDetail(t.founder.userId,t.leaf.id))!.admin_via).toEqual({id:t.mid.id,handle:'mid_team',name:'Mid'});
  // Its page through the route, as the browser reads it.
  const routed=await groupRoute(request(`/api/groups/${t.leaf.id}`,{actor:{credential:'session',userId:t.ann.userId,email:t.ann.email!,emailVerified:true}}),params(t.leaf.id));
  expect(routed.status).toBe(200);
  expect(await routed.json()).toMatchObject({group:{id:t.leaf.id,role:'admin'},admin_via:{id:t.root.id}});

  const fixture=new Set((await sql<{id:string}>('SELECT id FROM group_audit')).map(row=>row.id));
  const invitation=await inviteGroupMember(t.ann.userId,t.leaf.id,'mxmx_test_newcomer@example.com','member');
  expect((await getGroupDetail(t.ann.userId,t.leaf.id))!.invitations!.map(i=>i.id)).toEqual([invitation.id]);
  await removeGroupInvitation(t.ann.userId,t.leaf.id,invitation.id);
  await setGroupMember(t.ann.userId,t.leaf.id,t.mia.userId,'admin');
  expect((await getGroupDetail(t.lee.userId,t.leaf.id))!.members.find(m=>m.user_id===t.mia.userId)!.role).toBe('admin');
  expect((await updateGroup(t.ann.userId,t.leaf.id,{name:'Leaf, renamed'})).name).toBe('Leaf, renamed');
  await setGroupLink(t.ann.userId,t.leaf.id,t.root.id,true);
  expect((await getGroupDetail(t.ann.userId,t.leaf.id))!.linked_groups.map(g=>g.id)).toEqual([t.root.id]);
  // Moves: out from under Mid to Root (an admin of Leaf, of Mid and of Root), and back.
  expect((await setGroupParent(t.ann.userId,t.leaf.id,t.root.id,t.mid.id)).changed).toBe(true);
  expect((await setGroupParent(t.ann.userId,t.leaf.id,t.mid.id,t.root.id)).changed).toBe(true);
  // A subgroup beneath Leaf: its creator becomes its first direct admin, as anyone's would.
  const tip=await createGroup(t.ann.userId,{handle:'tip_team',name:'Tip',parent_id:t.leaf.id});
  expect(tip.role).toBe('admin');
  // The tree's relatives read the role the reader holds there: Leaf's subgroups, and Mid's, administered by Ann.
  expect((await getGroupDetail(t.ann.userId,t.mid.id))!.subgroups).toEqual([{id:t.leaf.id,handle:'leaf_team',name:'Leaf, renamed',role:'admin'}]);
  await removeGroupMember(t.ann.userId,t.leaf.id,t.mia.userId);
  expect((await getGroupDetail(t.lee.userId,t.leaf.id))!.members.map(m=>m.user_id)).toEqual([t.lee.userId]);
  // Audit and events record the acting person.
  const audited=(await sql<{id:string;actor_user_id:string;action:string}>('SELECT id,actor_user_id,action FROM group_audit WHERE group_id=$1',[t.leaf.id])).filter(row=>!fixture.has(row.id));
  expect(new Set(audited.map(row=>row.action))).toEqual(new Set(['invited','uninvited','role_changed','updated','linked','reparented','subgroup_attached','member_removed']));
  expect(new Set(audited.map(row=>row.actor_user_id))).toEqual(new Set([t.ann.userId]));
  // Never mailed as Leaf's member.
  expect(await sql('SELECT 1 FROM group_mail_outbox WHERE group_id=$1 AND recipient_id=$2',[t.leaf.id,t.ann.userId])).toEqual([]);
 });

 it('deletes a subgroup as a direct admin would: the app refuses one that still owns work, then it goes, mailing its members only',async()=>{
  const t=await tree();
  const owned=await mine(t.lee,'Leaf work',{visibility:'private',destination:{type:'group',id:t.leaf.id}});
  await refused(deleteGroup(t.ann.userId,t.leaf.id,'leaf_team'),'group_not_empty');
  expect(await trashArtifactFor(t.ann,owned.id)).toEqual([owned.id]);
  await deleteGroup(t.ann.userId,t.leaf.id,'leaf_team');
  expect(await getGroupDetail(t.lee.userId,t.leaf.id)).toBeNull();
  const mailed=(await sql<{recipient_id:string}>("SELECT recipient_id FROM group_mail_outbox WHERE group_id=$1 AND action='deleted'",[t.leaf.id])).map(r=>r.recipient_id).sort();
  expect(mailed).toEqual([t.lee.userId,t.mia.userId].sort());
 });

 it('owns Leaf-owned work exactly as Leaf\'s direct admin does: reads, edits, shares, transfers and deletes it, through every source',async()=>{
  const t=await tree();
  const page=await mine(t.lee,'Leaf page',{visibility:'private',destination:{type:'group',id:t.leaf.id}});
  const data=await dataset(t.lee,{version:3,tables:[]},{visibility:'private',destination:{type:'group',id:t.leaf.id}});
  for(const id of [page.id,data.id]){
   expect(await roleOf(id,t.lee)).toBe('owner');
   expect(await roleOf(id,t.ann),'through Root').toBe('owner');
   expect(await roleOf(id,t.founder),'through Mid').toBe('owner');
   expect(await roleOf(id,t.mia)).toBe('viewer');
  }
  expect((await datasetWriteAccess(await head(data.id),t.ann)).role).toBe((await datasetWriteAccess(await head(data.id),t.lee)).role);
  // Sharing, as its owner: a person, and Leaf itself.
  expect(await updateSharingFor(t.ann,page.id,{shares:[{email:t.meg.email!,role:'viewer'}]})).not.toBeNull();
  // (A named viewer share is not a comment-feed observer, so only the decision itself is asked here.)
  expect(await effectiveRole(await head(page.id),t.meg)).toBe('viewer');
  expect(await setArtifactGroupShare(t.ann,page.id,t.leaf.id,'commenter')).toEqual({changed:true});
  // Publishing into Leaf, and transferring Leaf's work to Mid, both groups Ann administers.
  const published=await mine(t.ann,'Published by Ann',{visibility:'private',destination:{type:'group',id:t.leaf.id}});
  expect((await head(published.id)).group_id).toBe(t.leaf.id);
  expect((await transferArtifact(t.ann,published.id,{type:'group',id:t.mid.id}))?.group_id).toBe(t.mid.id);
  expect(await trashArtifactFor(t.ann,page.id)).toEqual([page.id]);
 });
});

describe('Editor and Member never flow down, and nothing flows up',()=>{
 it('an Editor and a Member of Root gain nothing in Leaf; Leaf\'s admin gains nothing in Mid',async()=>{
  const t=await tree();
  const page=await mine(t.lee,'Leaf private',{visibility:'private',destination:{type:'group',id:t.leaf.id}});
  const rootPage=await mine(t.founder,'Root private',{visibility:'private',destination:{type:'group',id:t.root.id}});
  for(const person of [t.ed,t.meg]){
   expect(await getGroupDetail(person.userId,t.leaf.id),person.email!).toBeNull();
   await refused(inviteGroupMember(person.userId,t.leaf.id,'mxmx_test_x@example.com','member'),'not_found');
   await refused(updateGroup(person.userId,t.leaf.id,{name:'Mine'}),'not_found');
   await refused(createGroup(person.userId,{handle:`sub_${person.userId.slice(-6).toLowerCase()}`,name:'Sub',parent_id:t.leaf.id}),'parent_not_found');
   await refused(setGroupMember(person.userId,t.leaf.id,t.mia.userId,'member'),'not_found');
   expect(await roleOf(page.id,person)).toBe('none');
   await expect(mine(person,'Into Leaf',{destination:{type:'group',id:t.leaf.id}})).rejects.toThrow(/Publication is unavailable/);
  }
  // At Root itself their direct roles are unchanged.
  expect(await roleOf(rootPage.id,t.ed)).toBe('viewer');
  expect(await roleOf(rootPage.id,t.meg)).toBe('viewer');
  // Leaf's own admin administers nothing above Leaf.
  expect((await getGroupDetail(t.lee.userId,t.mid.id))).toBeNull();
  await refused(updateGroup(t.lee.userId,t.mid.id,{name:'Mine'}),'not_found');
  expect(await sql('SELECT group_id,via_group_id FROM group_admins WHERE user_id=$1',[t.lee.userId])).toEqual([{group_id:t.leaf.id,via_group_id:t.leaf.id}]);
 });

 it('the group_admins view lists direct and inherited admins with the nearest group holding the direct row',async()=>{
  const t=await tree();
  const rows=await sql<{user_id:string;via_group_id:string}>('SELECT user_id,via_group_id FROM group_admins WHERE group_id=$1 ORDER BY user_id',[t.leaf.id]);
  expect(rows).toEqual([
   {user_id:t.ann.userId,via_group_id:t.root.id},{user_id:t.founder.userId,via_group_id:t.mid.id},{user_id:t.lee.userId,via_group_id:t.leaf.id},
  ].sort((a,b)=>a.user_id<b.user_id?-1:1));
 });
});

describe('revocation and the last-admin guard',()=>{
 it('losing the Root role ends the authority over every group below it on the next decision',async()=>{
  const t=await tree();
  const page=await mine(t.lee,'Leaf page',{visibility:'private',destination:{type:'group',id:t.leaf.id}});
  expect(await roleOf(page.id,t.ann)).toBe('owner');
  await setGroupMember(t.founder.userId,t.root.id,t.ann.userId,'member');
  expect(await getGroupDetail(t.ann.userId,t.leaf.id)).toBeNull();
  expect(await roleOf(page.id,t.ann)).toBe('none');
  await refused(inviteGroupMember(t.ann.userId,t.leaf.id,'mxmx_test_late@example.com','member'),'not_found');
  await refused(setGroupMember(t.ann.userId,t.leaf.id,t.mia.userId,'member'),'not_found');
  expect(await sql('SELECT group_id FROM group_admins WHERE user_id=$1',[t.ann.userId])).toEqual([]);
 });

 it('an inherited admin never counts as a group\'s last admin: Leaf keeps its one direct admin',async()=>{
  const t=await tree();
  await refused(setGroupMember(t.ann.userId,t.leaf.id,t.lee.userId,'member'),'last_admin');
  await refused(removeGroupMember(t.ann.userId,t.leaf.id,t.lee.userId),'last_admin');
  await refused(removeGroupMember(t.lee.userId,t.leaf.id,t.lee.userId),'last_admin');
  // Once Leaf has a second direct admin, either may step down, as before.
  await admitGroupMember(t.ann.userId,t.leaf.id,t.mia.userId,'admin');
  await setGroupMember(t.ann.userId,t.leaf.id,t.lee.userId,'member');
  expect((await getGroupDetail(t.mia.userId,t.leaf.id))!.members.filter(m=>m.role==='admin').map(m=>m.user_id)).toEqual([t.mia.userId]);
 });
});
