/** Group administration and content editing are distinct; personal ownership is independent of both. */
import {expect,it} from 'vitest';
import {useAppHarness,admitGroupMember} from './harness';
import {account,mine} from './artifact-fixtures';
import {createGroup,getGroupRole,getGroupDetail,setGroupMember,removeGroupMember,inviteGroupMember,acceptGroupInvitations} from '@/lib/groups';
import {getDb} from '@/lib/platform';
import {effectiveRole,editorScope,ownerScope} from '@/lib/artifact-access';
import {getArtifactById,setArtifactGroupShare} from '@/lib/artifacts';
useAppHarness();

it('separates administration, publishing, editing and private personal ownership',async()=>{
 const admin=await account('mxmx_test_admin@example.com'),editor=await account('mxmx_test_editor@example.com'),member=await account('mxmx_test_member@example.com');
 const group=await createGroup(admin.userId!,{handle:'role_team',name:'Role team'});
 expect(group.role).toBe('admin');
 await admitGroupMember(admin.userId!,group.id,editor.userId!,'member');
 await admitGroupMember(admin.userId!,group.id,member.userId!,'member');
 await expect(setGroupMember(editor.userId!,group.id,member.userId!,'admin')).rejects.toMatchObject({code:'forbidden'});
 await expect(inviteGroupMember(editor.userId!,group.id,'mxmx_test_invitee@example.com','member')).rejects.toMatchObject({code:'forbidden'});
 expect((await getGroupDetail(editor.userId!,group.id))?.invitations).toBeUndefined();
 const shared=await mine(admin,'Shared',{destination:{type:'group',id:group.id},visibility:'private'});
 const row=(await getArtifactById(shared.id))!;
 const db=await getDb();
 for(const [actor,role] of [[admin,'owner'],[editor,'viewer'],[member,'viewer']] as const){
  expect(await effectiveRole(row,actor)).toBe(role);
  for(const [scope,allowed] of [[editorScope(actor),role!=='viewer'],[ownerScope(actor),role==='owner']] as const)
   expect((await db.query(`SELECT id FROM artifacts WHERE id=$1 AND (${scope.where('$2')})`,[row.id,scope.val])).rows.length).toBe(allowed?1:0);
 }
 expect(await setArtifactGroupShare(editor,row.id,group.id,'editor')).toBeNull();
 await expect(mine(member,'Personal',{destination:{type:'group',id:group.id}})).rejects.toThrow();
 const personal=await mine(member,'Personal',{destination:{type:'personal'},visibility:'private'});
 expect(await effectiveRole((await getArtifactById(personal.id))!,member)).toBe('owner');
 expect(await effectiveRole((await getArtifactById(personal.id))!,admin)).toBe('none');
 await removeGroupMember(admin.userId!,group.id,editor.userId!);
 expect(await effectiveRole(row,editor)).toBe('none');
});

it('protects the final admin and never downgrades a stronger role when accepting an invitation',async()=>{
 const admin=await account('mxmx_test_admin@example.com'),other=await account('mxmx_test_other@example.com');
 const group=await createGroup(admin.userId!,{handle:'admin_team',name:'Admin team'});
 await expect(setGroupMember(admin.userId!,group.id,admin.userId!,'member')).rejects.toMatchObject({code:'last_admin'});
 await expect(removeGroupMember(admin.userId!,group.id,admin.userId!)).rejects.toMatchObject({code:'last_admin'});
 await admitGroupMember(admin.userId!,group.id,other.userId!,'admin');
 await inviteGroupMember(admin.userId!,group.id,other.email!,'member');
 await acceptGroupInvitations(other.userId!,other.email!);
 expect(await getGroupRole(other.userId!,group.id)).toBe('admin');
 await setGroupMember(admin.userId!,group.id,other.userId!,'admin');
 await inviteGroupMember(admin.userId!,group.id,other.email!,'member');
 await acceptGroupInvitations(other.userId!,other.email!);
 expect(await getGroupRole(other.userId!,group.id)).toBe('admin');
 await removeGroupMember(other.userId!,group.id,admin.userId!);
});

it('reads a legacy Editor row as Member and cannot assign Editor to a new seat',async()=>{
 const admin=await account('mxmx_test_legacy_admin@example.com'),legacy=await account('mxmx_test_legacy_member@example.com');
 const group=await createGroup(admin.userId!,{handle:'legacy_team',name:'Legacy team'});
 const db=await getDb();
 await db.query("INSERT INTO auth.group_members(group_id,user_id,role) VALUES($1,$2,'editor')",[group.id,legacy.userId]);
 await db.query("INSERT INTO auth.group_invitations(id,group_id,email,role,invited_by) VALUES('gin_legacy',$1,$2,'editor',$3)",[group.id,legacy.email,admin.userId]);
 const detail=await getGroupDetail(admin.userId!,group.id);
 expect(detail?.members.find(member=>member.user_id===legacy.userId)?.role).toBe('member');
 expect(detail?.invitations?.[0]?.role).toBe('member');
 expect(await getGroupRole(legacy.userId!,group.id)).toBe('member');
 await expect(setGroupMember(admin.userId!,group.id,legacy.userId!,'editor' as never)).rejects.toMatchObject({code:'invalid_role'});
 await acceptGroupInvitations(legacy.userId!,legacy.email!);
 expect((await db.query('SELECT role FROM auth.group_members WHERE group_id=$1 AND user_id=$2',[group.id,legacy.userId])).rows).toEqual([{role:'member'}]);
});
