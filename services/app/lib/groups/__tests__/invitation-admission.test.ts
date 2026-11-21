import {afterEach,it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {account,sql} from '@/__tests__/artifact-fixtures';
import {getDb,syncIdentitySettings} from '@/lib/platform';
import {admitDeploymentIdentity,setupDeployment} from '@/lib/deployment';
import {overrideConfig,resetConfigOverrides} from '@/lib/platform/config';
import {createGroup,inviteGroupMember} from '..';
useAppHarness();
afterEach(resetConfigOverrides);
async function companyGroup(handle:string){
 const owner=await account('mxmx_test_owner@example.com');
 overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:owner.email!,AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com'});
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
