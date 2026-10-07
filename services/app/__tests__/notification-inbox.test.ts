import {seedOwnerJoin} from '@/lib/accounts';
import {notificationArtifactAuthority,notificationSourceSchema} from '@/lib/notifications';
import {expect,it,vi} from 'vitest';
import {useAppHarness,request,setSession} from './harness';
import {PATCH as patchInbox} from '@/app/api/my/people/route';
import {POST as create} from '@/app/api/artifacts/route';
import {createUser} from '@/lib/accounts';
import {mintToken} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {membershipInbox,updateMembershipInbox} from '@/lib/accounts';
import {POST as delivery} from '@/app/api/internal/notifications/route';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
vi.mock('@/lib/platform/config',async original=>({...await original<typeof import('@/lib/platform/config')>(),INTERNAL_SERVICE_SECRET:'notification-test-service'}));
import {notifyThread,recordNotification} from '@/lib/notifications/write';
useAppHarness();
async function fixture(){
 const sender=await createUser({email:'sender@example.com'}),recipient=await createUser({email:'recipient@example.com'}),token=await mintToken('test',sender.id);
 const publish=async(body:object)=>(await create(request('/api/artifacts',{method:'POST',token:token.token,json:body}))).json();
 const doc=await publish({markup:'<p>Tasks</p>',visibility:'unlisted'}),source=await publish({dataset:[{n:1}],visibility:'unlisted'}),db=await getDb();
 const input={origin:{mutationName:'change'},bindings:{userId:sender.id}};
 await db.query("INSERT INTO notification_jobs(id,mutation_run_id,document_id,input) VALUES('job','run',$1,$2::jsonb)",[doc.id,JSON.stringify(input)]);
 await seedOwnerJoin(db,doc.id,recipient.id);
 const authority=await notificationArtifactAuthority(db,source.id);
 await db.query(`INSERT INTO mutation_notifications(id,job_id,mutation_run_id,recipient_id,artifact_id,initiator,messages,sources) VALUES('n0','job','run',$1,$2,$3::jsonb,$4::jsonb,$5::jsonb)`,[recipient.id,doc.id,JSON.stringify({principal:{kind:'token',id:token.id},execution:'agent'}),JSON.stringify(['Task is Done','Review is ready']),JSON.stringify([{artifactId:source.id,authorityRevision:authority.revision,schemaRevision:notificationSourceSchema(authority)}])]);
 return {sender,recipient,token,doc,source,db,actor:{userId:recipient.id,tokenId:null}};
}
it('projects a combined run card, the saved user actor, and revision acknowledgments without private provenance',async()=>{
 const f=await fixture(),inbox=await membershipInbox(f.actor);
 expect(inbox.notifications).toHaveLength(1);expect(inbox.unread).toBe(1);
 expect(inbox.notifications[0]).toMatchObject({kind:'mutation',messages:['Task is Done','Review is ready'],actor:{kind:'user',userId:f.sender.id,viaAgent:true},mutation_run_id:'run'});
 expect(JSON.stringify(inbox)).not.toContain(f.token.id);expect(JSON.stringify(inbox)).not.toContain('schemaRevision');
 expect((await updateMembershipInbox(f.actor,{read:'n0',revision:1})).unread).toBe(0);
});
it('marks every notification read across pages and kinds, preserves history and isolates the recipient',async()=>{
 const f=await fixture();
 await f.db.transaction(async tx=>{
  for(let i=0;i<51;i++)await recordNotification(tx,{id:`follow-${i}`,artifactId:null,recipientId:f.recipient.id,senderId:f.sender.id,kind:'follow',revision:3});
  await recordNotification(tx,{id:'other',artifactId:null,recipientId:f.sender.id,senderId:f.recipient.id,kind:'follow'});
 });
 setSession({user:{id:f.recipient.id,email:f.recipient.email}});
 const clear=()=>patchInbox(request('/api/my/people',{method:'PATCH',json:{readAll:true}}));
 const response=await clear();expect(response.status).toBe(200);
 const inbox=await response.json();expect(inbox.unread).toBe(0);expect(inbox.notifications).toHaveLength(50);expect(inbox.next).toBe(50);
 expect((await membershipInbox(f.actor,50)).notifications).toHaveLength(2);
 const rows=(await f.db.query<{revision:number;seen_revision:number;read_at:string}>('SELECT revision,seen_revision,read_at FROM member_notifications WHERE recipient_id=$1 UNION ALL SELECT revision,seen_revision,read_at FROM mutation_notifications WHERE recipient_id=$1',[f.recipient.id])).rows;
 expect(rows).toHaveLength(52);for(const row of rows){expect(row.seen_revision).toBe(row.revision);expect(row.read_at).not.toBeNull();}
 expect((await membershipInbox({userId:f.sender.id,tokenId:null})).unread).toBe(1);
 expect((await clear()).status).toBe(200);
 await f.db.transaction(tx=>recordNotification(tx,{id:'follow-0',artifactId:null,recipientId:f.recipient.id,senderId:f.sender.id,kind:'follow'}));
 expect((await membershipInbox(f.actor)).unread).toBe(1);
 setSession(null);expect((await clear()).status).toBe(401);
});
it('hides saved messages after any source or document revocation and either direction of blocking',async()=>{
 const f=await fixture();expect((await membershipInbox(f.actor)).notifications).toHaveLength(1);
 await f.db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.source.id]);expect((await membershipInbox(f.actor)).notifications).toEqual([]);
 await f.db.query("UPDATE artifacts SET visibility='unlisted' WHERE id=$1",[f.source.id]);
 await f.db.query('INSERT INTO user_blocks(user_id,blocked_user_id) VALUES($1,$2)',[f.sender.id,f.recipient.id]);expect((await membershipInbox(f.actor)).notifications).toEqual([]);
 await f.db.query('DELETE FROM user_blocks');await f.db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[f.doc.id]);expect((await membershipInbox(f.actor)).notifications).toEqual([]);
});

it('rechecks the internal delivery projection and never returns private sources',async()=>{
 const f=await fixture();const read=async()=>delivery(request('/api/internal/notifications',{method:'POST',headers:{[SERVICE_AUTH_HEADER]:'notification-test-service'},json:{recipientId:f.recipient.id,notificationId:'n0'}}));
 const first=await (await read()).json();expect(first.notification.messages).toEqual(['Task is Done','Review is ready']);expect(first.notification.actor.userId).toBe(f.sender.id);expect(first.notification.sources).toBeUndefined();expect(first.notification.input).toBeUndefined();
 await f.db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.source.id]);expect(await (await read()).json()).toEqual({notification:null});
});
it('uses a deleted-user fallback and current ownership rather than historical source owner',async()=>{
 const f=await fixture();await f.db.query('UPDATE users SET expires_at=now() WHERE id=$1',[f.sender.id]);
 expect((await membershipInbox(f.actor)).notifications[0]).toMatchObject({actor:{kind:'deleted-user'}});
 await f.db.query("UPDATE artifacts SET visibility='private',user_id=$2 WHERE id=$1",[f.source.id,f.recipient.id]);expect((await membershipInbox(f.actor)).notifications).toHaveLength(1);
 await f.db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[f.source.id]);expect((await membershipInbox(f.actor)).notifications).toEqual([]);
});

it('leaving hides existing items and prevents queued delivery without changing legacy invitations',async()=>{
 const f=await fixture();
 await f.db.query("UPDATE relations SET status='left',deleted_at=now() WHERE subject_id=$1 AND object_id=$2",[f.recipient.id,f.doc.id]);
 expect((await membershipInbox(f.actor)).notifications).toEqual([]);
 const response=await delivery(request('/api/internal/notifications',{method:'POST',headers:{[SERVICE_AUTH_HEADER]:'notification-test-service'},json:{recipientId:f.recipient.id,notificationId:'n0'}}));
 expect(await response.json()).toEqual({notification:null});
});

it('preserves the latest agent attribution while the unread conversation still targets its first update', async () => {
 const f=await fixture();
 await f.db.query('DELETE FROM mutation_notifications');
 await f.db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'commenter')",[f.doc.id,f.recipient.id,f.recipient.email]);
 await f.db.query(`INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id,author_label) VALUES
 ('root',$1,NULL,'Question','human',$2,'Reader'),
 ('human-reply',$1,'root','First answer','human',$3,'Sender'),
 ('agent-reply',$1,'root','Agent answer','agent',$3,'afbin')`,[f.doc.id,f.recipient.id,f.sender.id]);
 await f.db.transaction(tx=>notifyThread(tx,f.doc.id,'root',f.sender.id,'reply',false,'human-reply'));
 await f.db.transaction(tx=>notifyThread(tx,f.doc.id,'root',f.sender.id,'reply',true,'agent-reply'));
 const row=(await membershipInbox(f.actor)).notifications.find(n=>n.id===`thread:root:${f.recipient.id}`);
 expect(row).toMatchObject({sender_id:f.sender.id,first_update_id:'human-reply',agent_label:'afbin'});
 await f.db.transaction(tx=>notifyThread(tx,f.doc.id,'root',f.sender.id,'reply',false,'human-reply'));
 expect((await membershipInbox(f.actor)).notifications.find(n=>n.id===`thread:root:${f.recipient.id}`)).toMatchObject({agent_label:null});
});
