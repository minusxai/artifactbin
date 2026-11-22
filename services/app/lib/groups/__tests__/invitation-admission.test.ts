import {afterEach,it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {account,sql} from '@/__tests__/artifact-fixtures';
import {getDb,services,syncIdentitySettings} from '@/lib/platform';
import {admitDeploymentIdentity,setupDeployment} from '@/lib/deployment';
import {overrideConfig,resetConfigOverrides} from '@/lib/platform/config';
import {createGroup,deleteGroup,inviteGroupMember,removeGroupMember,setGroupMember} from '..';
useAppHarness();
afterEach(resetConfigOverrides);
async function companyGroup(handle:string){
 const owner=await account('mxmx_test_owner@example.com');
 overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:owner.email!,AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com',AUTH__INVITE_ONLY:'false'});
 await syncIdentitySettings(await getDb());
 expect(await admitDeploymentIdentity({userId:owner.userId,email:owner.email!,emailVerified:true})).toBe(true);
 const group=await createGroup(owner.userId,{handle,name:'Admission'});
 await setupDeployment(owner.userId,group.id);
 return {owner,group};
}
it('refuses company invitations blocked by sign-in policy before creating mail or invitations',async()=>{
 const {owner,group}=await companyGroup('admission');
 await expect(inviteGroupMember(owner.userId,group.id,'mxmx_test_guest@other.com','member')).rejects.toMatchObject({code:'invitation_email_not_allowed',status:400});
 expect(await sql('SELECT id FROM group_invitations')).toEqual([]);
 expect(await sql('SELECT id FROM group_mail_outbox')).toEqual([]);
 expect(await sql("SELECT id FROM group_audit WHERE action='invited'")).toEqual([]);
 await expect(inviteGroupMember(owner.userId,group.id,'mxmx_test_allowed@example.com','member')).resolves.toMatchObject({email:'mxmx_test_allowed@example.com'});
});
it('preserves public installations and wildcard invitation-only installations',async()=>{
 const owner=await account('mxmx_test_owner@example.com');
 overrideConfig({}, {APP__DEPLOYMENT_MODE:'public',AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com'});
 await syncIdentitySettings(await getDb());
 const group=await createGroup(owner.userId,{handle:'public_admission',name:'Admission'});
 await expect(inviteGroupMember(owner.userId,group.id,'mxmx_test_public@other.com','member')).resolves.toBeDefined();
 overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:owner.email!,AUTH__INVITE_ONLY:'true',AUTH__ALLOWED_EMAIL_PATTERNS:'*'});
 await syncIdentitySettings(await getDb());
 await expect(inviteGroupMember(owner.userId,group.id,'mxmx_test_invited@other.com','member')).resolves.toBeDefined();
});
it('checks inviter authority first and preserves access for already admitted accounts',async()=>{
 const {owner,group}=await companyGroup('existing_admission');
 const member=await account('mxmx_test_admitted@other.com');
 await expect(inviteGroupMember(member.userId,group.id,'mxmx_test_other@other.com','member')).rejects.toMatchObject({code:'not_found',status:404});
 await sql('INSERT INTO deployment_members(user_id) VALUES ($1)',[member.userId]);
 await expect(inviteGroupMember(owner.userId,group.id,member.email!,'member')).resolves.toBeDefined();
});

it('revokes admission when a root seat is removed, preserving other seats and allowing an explicit reinvitation',async()=>{
 const {owner,group}=await companyGroup('company_root');
 const person=await account('mxmx_test_departing@example.com');
 const identity={userId:person.userId,email:person.email!,emailVerified:true};
 expect(await admitDeploymentIdentity(identity)).toBe(true);
 const subgroup=await createGroup(owner.userId,{handle:'other_team',name:'Other team',parent_id:group.id});
 await sql("INSERT INTO auth.group_members(group_id,user_id,role) VALUES ($1,$2,'member')",[subgroup.id,person.userId]);
 await inviteGroupMember(owner.userId,group.id,person.email!,'member');
 await removeGroupMember(owner.userId,group.id,person.userId);
 expect(await sql('SELECT active FROM users WHERE id=$1',[person.userId])).toEqual([{active:false}]);
 expect(await admitDeploymentIdentity(identity)).toBe(false);
 expect(await sql('SELECT group_id FROM group_members WHERE user_id=$1',[person.userId])).toEqual([{group_id:subgroup.id}]);
 expect(await sql('SELECT user_id FROM deployment_members WHERE user_id=$1',[person.userId])).toEqual([{user_id:person.userId}]);
 await inviteGroupMember(owner.userId,group.id,person.email!,'member');
 expect(await admitDeploymentIdentity(identity)).toBe(true);
 expect(await sql('SELECT active FROM users WHERE id=$1',[person.userId])).toEqual([{active:true}]);
 await sql("UPDATE auth.group_members SET role='admin' WHERE group_id=$1 AND user_id=$2",[group.id,person.userId]);
 await expect(removeGroupMember(owner.userId,group.id,owner.userId)).rejects.toMatchObject({code:'deployment_owner_required',status:409});
});

it('refuses manual invitations and ignores old invitations for issuer-managed groups',async()=>{
 const {owner,group}=await companyGroup('issuer_root');
 const subgroup=await createGroup(owner.userId,{handle:'issuer_group',name:'Issuer group',parent_id:group.id});
 const person=await account('mxmx_test_invitee@example.com');
 await sql("UPDATE auth.groups SET trusted_issuer='example-issuer' WHERE id=$1",[subgroup.id]);
 await expect(inviteGroupMember(owner.userId,subgroup.id,person.email!,'member')).rejects.toMatchObject({code:'host_managed_membership',status:403});
 await sql("INSERT INTO auth.group_invitations(id,group_id,email,role,invited_by) VALUES ('legacy',$1,$2,'member',$3)",[subgroup.id,person.email,owner.userId]);
 expect(await services().identity.acceptGroupInvitations({userId:person.userId,email:person.email!})).toEqual({groupIds:[],changes:[]});
 expect(await sql('SELECT group_id FROM group_members WHERE user_id=$1',[person.userId])).toEqual([]);
 expect(await sql("SELECT id FROM group_invitations WHERE id='legacy'")).toEqual([{id:'legacy'}]);
});

it('keeps host-managed seats under issuer control for both direct and inherited admins',async()=>{
 const {owner,group}=await companyGroup('managed_root');
 const direct=await account('mxmx_test_direct@example.com');
 const member=await account('mxmx_test_member@example.com');
 const subgroup=await createGroup(owner.userId,{handle:'managed_team',name:'Managed team',parent_id:group.id});
 await sql("UPDATE auth.groups SET trusted_issuer='example-issuer' WHERE id=$1",[subgroup.id]);
 await sql("INSERT INTO auth.group_members(group_id,user_id,role) VALUES ($1,$2,'member')",[subgroup.id,member.userId]);
 await sql("UPDATE auth.group_members SET user_id=$2 WHERE group_id=$1 AND role='admin'",[subgroup.id,direct.userId]);
 const refusal={code:'host_managed_membership',status:403};
 for(const actor of [owner,direct]){
  await expect(setGroupMember(actor.userId,subgroup.id,member.userId,'admin')).rejects.toMatchObject(refusal);
  await expect(removeGroupMember(actor.userId,subgroup.id,member.userId)).rejects.toMatchObject(refusal);
  await expect(deleteGroup(actor.userId,subgroup.id,subgroup.handle)).rejects.toMatchObject(refusal);
 }
 await expect(removeGroupMember(member.userId,subgroup.id,member.userId)).rejects.toMatchObject(refusal);
 expect(await services().identity.admitToGroup({userId:owner.userId,email:owner.email!,groupId:subgroup.id,inviteOnly:false}))
  .toEqual({admitted:false,changes:[]});
 expect(await sql('SELECT user_id,role FROM group_members WHERE group_id=$1 ORDER BY role',[subgroup.id]))
  .toEqual([{user_id:direct.userId,role:'admin'},{user_id:member.userId,role:'member'}]);
});
