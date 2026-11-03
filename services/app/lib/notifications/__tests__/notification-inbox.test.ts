import {nativeHtml} from '@/__tests__/native-html-fixture';
import { identityForUser } from '@/lib/accounts';
import { membershipInbox } from '@/lib/notifications';
import {beforeEach,expect,it} from 'vitest';
import {useAppHarness,request,setSession} from '@/__tests__/harness';
import {PATCH as patchInbox} from '@/app/api/my/people/route';
import {POST as create} from '@/app/api/artifacts/route';
import { createUser } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {notifyThread,recordNotification} from '@/lib/notifications';
import {POST as delivery} from '@/app/api/internal/notifications/route';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {overrideConfig} from '@/lib/platform/config';
useAppHarness();
beforeEach(()=>overrideConfig({internalServiceSecret:'notification-test-service'}));
async function fixture(){
 const sender=await createUser({email:'sender@example.com'}),recipient=await createUser({email:'recipient@example.com'}),token=await mintToken('test',sender.id);
 const publish=async(body:object)=>(await create(request('/api/artifacts',{method:'POST',token:token.token,json:body}))).json();
 const doc=await publish({html: nativeHtml('<p>Tasks</p>'),visibility:'unlisted'}),db=await getDb();
 return {sender,recipient,token,doc,db,actor:identityForUser(recipient.id, null)};
}
it('marks every notification read across pages, preserves history and isolates the recipient',async()=>{
 const f=await fixture();
 await f.db.transaction(async tx=>{
  for(let i=0;i<51;i++)await recordNotification(tx,{id:`follow-${i}`,artifactId:null,recipientId:f.recipient.id,senderId:f.sender.id,kind:'follow',revision:3});
  await recordNotification(tx,{id:'other',artifactId:null,recipientId:f.sender.id,senderId:f.recipient.id,kind:'follow'});
 });
 setSession({user:{id:f.recipient.id,email:f.recipient.email}});
 const clear=()=>patchInbox(request('/api/my/people',{method:'PATCH',json:{readAll:true}}));
 const response=await clear();expect(response.status).toBe(200);
 const inbox=await response.json();expect(inbox.unread).toBe(0);expect(inbox.notifications).toHaveLength(50);expect(inbox.next).toBe(50);
 expect((await membershipInbox(f.actor,50)).notifications).toHaveLength(1);
 const rows=(await f.db.query<{revision:number;seen_revision:number;read_at:string}>('SELECT revision,seen_revision,read_at FROM member_notifications WHERE recipient_id=$1',[f.recipient.id])).rows;
 expect(rows).toHaveLength(51);for(const row of rows){expect(row.seen_revision).toBe(row.revision);expect(row.read_at).not.toBeNull();}
 expect((await membershipInbox(identityForUser(f.sender.id, null))).unread).toBe(1);
 expect((await clear()).status).toBe(200);
 await f.db.transaction(tx=>recordNotification(tx,{id:'follow-0',artifactId:null,recipientId:f.recipient.id,senderId:f.sender.id,kind:'follow'}));
 expect((await membershipInbox(f.actor)).unread).toBe(1);
 setSession(null);expect((await clear()).status).toBe(401);
});
it('preserves the latest agent attribution while the unread conversation still targets its first update', async () => {
 const f=await fixture();
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
it('serves one member notification to the delivery service, with the recipient address, only while it is still visible',async()=>{
 const f=await fixture();
 const read=(notificationId:string,secret='notification-test-service')=>delivery(request('/api/internal/notifications',{method:'POST',headers:{[SERVICE_AUTH_HEADER]:secret},json:{recipientId:f.recipient.id,notificationId}}));
 await f.db.transaction(tx=>recordNotification(tx,{id:'follow-1',artifactId:null,recipientId:f.recipient.id,senderId:f.sender.id,kind:'follow'}));
 expect(await (await read('follow-1')).json()).toEqual({notification:expect.objectContaining({id:'follow-1',kind:'follow',sender_id:f.sender.id,email:f.recipient.email})});
 expect(await (await read('missing')).json()).toEqual({notification:null});
 expect((await read('follow-1','wrong-secret-of-same-size!')).status).toBe(401);
 await f.db.query('INSERT INTO user_blocks(user_id,blocked_user_id) VALUES($1,$2)',[f.recipient.id,f.sender.id]);
 expect(await (await read('follow-1')).json()).toEqual({notification:null});
});
