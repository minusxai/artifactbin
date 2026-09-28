import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {createUser} from '@/lib/users';
import {mintToken} from '@/lib/tokens';
import {getDb} from '@/lib/db';
import {membershipInbox,updateMembershipInbox} from '@/lib/membership-inbox';
import {POST as delivery} from '@/app/api/internal/notifications/route';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
vi.mock('@/lib/config',async original=>({...await original<typeof import('@/lib/config')>(),INTERNAL_SERVICE_SECRET:'notification-test-service'}));
useAppHarness();
async function fixture(){
 const sender=await createUser({email:'sender@example.com'}),recipient=await createUser({email:'recipient@example.com'}),token=await mintToken('test',sender.id);
 const publish=async(body:object)=>(await create(request('/api/artifacts',{method:'POST',token:token.token,json:body}))).json();
 const doc=await publish({markup:'<p>Tasks</p>',visibility:'unlisted'}),source=await publish({dataset:[{n:1}],visibility:'unlisted'}),db=await getDb();
 const input={origin:{mutationName:'change'},bindings:{userId:sender.id}};
 await db.query("INSERT INTO notification_jobs(id,mutation_run_id,rule_id,document_id,input) VALUES('job','run','notice',$1,$2::jsonb)",[doc.id,JSON.stringify(input)]);
 for(let i=0;i<2;i++)await db.query(`INSERT INTO mutation_notifications(id,job_id,output_ordinal,recipient_id,artifact_id,initiator,message,sources) VALUES($1,'job',$2,$3,$4,$5::jsonb,'Task is Done',$6::jsonb)`,['n'+i,i,recipient.id,doc.id,JSON.stringify({principal:{kind:'token',id:token.id},execution:'agent'}),JSON.stringify([{artifactId:source.id,schema:'public',table:'rows',authorityRevision:'',schemaRevision:''}])]);
 return {sender,recipient,token,doc,source,db,actor:{userId:recipient.id,tokenId:null}};
}
it('projects distinct rows, the saved user actor, and revision acknowledgments without private provenance',async()=>{
 const f=await fixture(),inbox=await membershipInbox(f.actor);
 expect(inbox.notifications).toHaveLength(2);expect(inbox.unread).toBe(2);
 expect(inbox.notifications[0]).toMatchObject({kind:'mutation',message:'Task is Done',actor:{kind:'user',userId:f.sender.id,viaAgent:true},mutation_run_id:'run'});
 expect(JSON.stringify(inbox)).not.toContain(f.token.id);expect(JSON.stringify(inbox)).not.toContain('schemaRevision');
 expect((await updateMembershipInbox(f.actor,{read:'n0',revision:1})).unread).toBe(1);
});
it('hides saved messages after any source or document revocation and either direction of blocking',async()=>{
 const f=await fixture();expect((await membershipInbox(f.actor)).notifications).toHaveLength(2);
 await f.db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.source.id]);expect((await membershipInbox(f.actor)).notifications).toEqual([]);
 await f.db.query("UPDATE artifacts SET visibility='unlisted' WHERE id=$1",[f.source.id]);
 await f.db.query('INSERT INTO user_blocks(user_id,blocked_user_id) VALUES($1,$2)',[f.sender.id,f.recipient.id]);expect((await membershipInbox(f.actor)).notifications).toEqual([]);
 await f.db.query('DELETE FROM user_blocks');await f.db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[f.doc.id]);expect((await membershipInbox(f.actor)).notifications).toEqual([]);
});

it('rechecks the internal delivery projection and never returns private sources',async()=>{
 const f=await fixture();const read=async()=>delivery(request('/api/internal/notifications',{method:'POST',headers:{[SERVICE_AUTH_HEADER]:'notification-test-service'},json:{recipientId:f.recipient.id,notificationId:'n0'}}));
 const first=await (await read()).json();expect(first.notification.message).toBe('Task is Done');expect(first.notification.actor.userId).toBe(f.sender.id);expect(first.notification.sources).toBeUndefined();expect(first.notification.input).toBeUndefined();
 await f.db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.source.id]);expect(await (await read()).json()).toEqual({notification:null});
});
it('uses a deleted-user fallback and current ownership rather than historical source owner',async()=>{
 const f=await fixture();await f.db.query('UPDATE users SET expires_at=now() WHERE id=$1',[f.sender.id]);
 expect((await membershipInbox(f.actor)).notifications[0]).toMatchObject({actor:{kind:'deleted-user'}});
 await f.db.query("UPDATE artifacts SET visibility='private',user_id=$2 WHERE id=$1",[f.source.id,f.recipient.id]);expect((await membershipInbox(f.actor)).notifications).toHaveLength(2);
 await f.db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[f.source.id]);expect((await membershipInbox(f.actor)).notifications).toEqual([]);
});
