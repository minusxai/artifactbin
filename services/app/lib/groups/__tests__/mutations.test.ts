import {afterEach,it,expect,vi} from 'vitest';
import {useAppHarness,admitGroupMember} from '@/__tests__/harness';
import {account,mine,sql} from '@/__tests__/artifact-fixtures';
import {mintToken} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {createGroup,inviteGroupMember,removeGroupMember,recordGroupMutation,groupQuota} from '..';
import {setArtifactGroupShare} from '@/lib/artifacts';
import {flushGroupMail,setNotificationDelivery,membershipInbox} from '@/lib/notifications';
useAppHarness();
afterEach(()=>setNotificationDelivery(undefined));
it('commits audit and true group recipient inbox/outbox once, then delivers after commit',async()=>{
 const owner=await account('mxmx_test_owner@example.com'),member=await account('mxmx_test_member@example.com');
 const token=await mintToken('test',owner.userId);await sql("UPDATE tokens SET client_harness='codex' WHERE id=$1",[token.id]);
 const group=await createGroup(owner.userId,{handle:'design_crit',name:'Design'}, {tokenId:token.id});
 const delivered=vi.fn(async(_message:unknown)=>{});
 setNotificationDelivery({preferences:async()=>({invitations:true,comments:true,activity:true}),updatePreferences:async(_id,p)=>p,click:async()=>null,sendGroupEmail:delivered});
 const first=await inviteGroupMember(owner.userId,group.id,member.email!,'viewer',{tokenId:token.id});
 const again=await inviteGroupMember(owner.userId,group.id,member.email!,'viewer',{tokenId:token.id});
 expect(first.changed).toBe(true);expect(again.changed).toBe(false);expect(delivered).not.toHaveBeenCalled();
 expect(await sql("SELECT actor_user_id,actor_token_id,client_harness FROM group_audit WHERE action='invited'")).toEqual([{actor_user_id:owner.userId,actor_token_id:token.id,client_harness:'codex'}]);
 expect(await sql('SELECT artifact_id,recipient_id,source FROM member_notifications')).toEqual([{artifact_id:null,recipient_id:member.userId,source:'group:'+group.id}]);
 expect((await membershipInbox(member)).notifications).toMatchObject([{kind:'group_invited',title:'Design',group_handle:group.handle}]);
 const db=await getDb();await flushGroupMail(db);await flushGroupMail(db);
 expect(delivered).toHaveBeenCalledTimes(1);expect(delivered.mock.calls[0]?.[0]).toMatchObject({groupId:group.id,email:member.email,action:'invited'});
 const before=(await sql('SELECT id FROM group_audit')).length;
 await expect(db.transaction(async tx=>{await recordGroupMutation(tx,owner.userId,group.id,'member_removed',{},[member.userId]);throw Error('rollback');})).rejects.toThrow('rollback');
 expect((await sql('SELECT id FROM group_audit')).length).toBe(before);
 await flushGroupMail(db);expect(delivered).toHaveBeenCalledTimes(1);
});
it('shares the durable account quota across callers and resets at the authoritative window boundary',async()=>{
 const owner=await account('mxmx_test_owner@example.com');const db=await getDb();const at=new Date('2026-11-03T00:00:00Z');
 await sql('INSERT INTO group_quotas(user_id,action,window_start,used) VALUES($1,$2,$3,59)',[owner.userId,'share',Math.floor(at.getTime()/1000)]);
 const results=await Promise.allSettled([db.transaction(tx=>groupQuota(tx,owner.userId,'share',at)),db.transaction(tx=>groupQuota(tx,owner.userId,'share',at))]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{code:'rate_limited',status:429,retryAfter:60}});
 await db.transaction(tx=>groupQuota(tx,owner.userId,'share',new Date(at.getTime()+60000)));
 expect(await sql('SELECT used FROM group_quotas')).toEqual([{used:1}]);
});
it('a shared editor cannot govern and unchanged share writes neither consume quota nor duplicate audit',async()=>{
 const owner=await account('mxmx_test_owner@example.com'),member=await account('mxmx_test_member@example.com');const group=await createGroup(owner.userId,{handle:'design_crit',name:'Design'});
 await admitGroupMember(owner.userId,group.id,member.userId,'viewer');const page=await mine(owner);
 await setArtifactGroupShare(owner,page.id,group.id,'editor');const before=await sql('SELECT used FROM group_quotas WHERE action=$1',['share']);
 expect(await setArtifactGroupShare(owner,page.id,group.id,'editor')).toEqual({changed:false});expect(await setArtifactGroupShare(member,page.id,group.id,'viewer')).toBeNull();
 expect(await sql('SELECT used FROM group_quotas WHERE action=$1',['share'])).toEqual(before);
 await removeGroupMember(owner.userId,group.id,member.userId);
 expect((await membershipInbox(member)).notifications.some(n=>n.kind==='group_member_removed')).toBe(true);
});

it('serializes the pending cap and permits unchanged invitations at capacity',async()=>{
 const owner=await account('mxmx_test_owner@example.com');const group=await createGroup(owner.userId,{handle:'pending_cap',name:'Pending'});
 await sql("INSERT INTO group_invitations(id,group_id,email,role,invited_by) SELECT 'seed_'||n,$1,'mxmx_test_'||n||'@example.com','viewer',$2 FROM generate_series(1,499) n",[group.id,owner.userId]);
 const results=await Promise.allSettled([inviteGroupMember(owner.userId,group.id,'mxmx_test_left@example.com','viewer'),inviteGroupMember(owner.userId,group.id,'mxmx_test_right@example.com','viewer')]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{code:'rate_limited',status:429}});
 expect(Number((await sql<{count:string}>('SELECT count(*) FROM group_invitations WHERE group_id=$1',[group.id]))[0].count)).toBe(500);
 const existing=await inviteGroupMember(owner.userId,group.id,'mxmx_test_1@example.com','viewer');expect(existing.changed).toBe(false);
});
it('retries delivery with one stable key and honors blocks and preferences',async()=>{
 const owner=await account('mxmx_test_owner@example.com'),member=await account('mxmx_test_member@example.com');const group=await createGroup(owner.userId,{handle:'mail_retry',name:'Mail'});
 const sent=vi.fn(async(_message:unknown):Promise<void>=>{throw Error('provider unavailable');});
 setNotificationDelivery({preferences:async()=>({invitations:true,activity:true,comments:true}),updatePreferences:async(_id,p)=>p,click:async()=>null,sendGroupEmail:sent});
 await inviteGroupMember(owner.userId,group.id,member.email!,'viewer');const db=await getDb();await flushGroupMail(db);
 expect((await sql('SELECT sent_at FROM group_mail_outbox'))[0]).toEqual({sent_at:null});
 sent.mockImplementation(async()=>{});await flushGroupMail(db);expect(sent).toHaveBeenCalledTimes(1);
 await sql("UPDATE group_mail_outbox SET next_attempt_at=now()-interval '1 second'");await flushGroupMail(db);
 expect(sent).toHaveBeenCalledTimes(2);expect(sent.mock.calls[0]?.[0]).toEqual(sent.mock.calls[1]?.[0]);
 await inviteGroupMember(owner.userId,group.id,member.email!,'editor');await sql('INSERT INTO user_blocks(user_id,blocked_user_id) VALUES($1,$2)',[member.userId,owner.userId]);
 await flushGroupMail(db);expect(sent).toHaveBeenCalledTimes(2);
});
