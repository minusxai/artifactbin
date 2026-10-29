/**
 * THE INBOX a person reads and changes (membershipInbox, updateMembershipInbox): what is visible
 * under current access, what reading acknowledges, what blocking hides and dismisses, and the
 * auto-accept setting that decides whether a mention from someone they follow is an invitation or
 * a join. Notifications are produced through recordNotification/recordEvent and the membership
 * doors, never by writing inbox rows directly.
 */
import {beforeEach,expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import { ANONYMOUS_ACTOR, identityForUser } from '@/lib/accounts';
import { link, seedOwnerJoin } from '@/lib/social';
import {changeMembership,getArtifactById,invitePeople} from '@/lib/artifacts';
import {recordEvent} from '@/lib/platform';
import {membershipInbox,recordNotification,updateMembershipInbox} from '@/lib/notifications';

useAppHarness();
type Db=Awaited<ReturnType<typeof getDb>>;
let db:Db;
const alice=identityForUser('alice',null,'alice@example.test'),bob=identityForUser('bob',null,'bob@example.test');
beforeEach(async()=>{
 db=await getDb();
 await db.query(`INSERT INTO users(id,email,username,kind) VALUES('alice','alice@example.test','alice','account'),('bob','bob@example.test','bob','account'),
  ('carol','carol@example.test','carol','account'),('guest','guest@example.test',NULL,'guest')`);
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,link_role) VALUES('doc','t','alice','html','public','commenter'),('secret','t','alice','html','private',NULL)");
});
const notify=(n:Partial<Parameters<typeof recordNotification>[1]>&{id:string})=>db.transaction(tx=>recordNotification(tx,{artifactId:'doc',recipientId:'bob',senderId:'alice',kind:'like',...n}));
const ids=async(actor=bob)=>(await membershipInbox(actor)).notifications.map(n=>n.id);

it('refuses a caller with no account, or a guest account, on both read and update',async()=>{
 await expect(membershipInbox(ANONYMOUS_ACTOR)).rejects.toThrow('Sign in to see notifications');
 await expect(membershipInbox(identityForUser('guest',null))).rejects.toThrow('Sign in to see notifications');
 await expect(updateMembershipInbox(ANONYMOUS_ACTOR,{readAll:true})).rejects.toThrow('Sign in to update notifications');
 await expect(updateMembershipInbox(identityForUser('guest',null),{readAll:true})).rejects.toThrow('Sign in to update notifications');
});

it('shows only what the recipient may still read: live artifacts, readable ones, follows without an artifact',async()=>{
 await notify({id:'on-doc'});
 await notify({id:'on-secret',artifactId:'secret'});
 await notify({id:'followed',artifactId:null,kind:'follow'});
 await notify({id:'orphan-like',artifactId:null,kind:'like'});
 expect((await ids()).sort()).toEqual(['followed','on-doc']);
 await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES('secret','bob','bob@example.test','viewer')");
 expect((await ids()).sort()).toEqual(['followed','on-doc','on-secret']);
 await db.query("UPDATE artifacts SET deleted_at=now() WHERE id='doc'");
 expect((await ids()).sort()).toEqual(['followed','on-secret']);
});

it('shows a conversation only while the recipient may comment and its thread still exists',async()=>{
 await db.query("INSERT INTO annotations(id,artifact_id,body,author_kind,author_user_id) VALUES('ann_1','doc','Hi','human','alice')");
 await notify({id:'thread:ann_1:bob',kind:'reply',source:'comment:ann_1'});
 expect(await ids()).toEqual(['thread:ann_1:bob']);
 await db.query("UPDATE artifacts SET link_role='viewer' WHERE id='doc'");
 expect(await ids()).toEqual([]);
 await db.query("UPDATE artifacts SET link_role='commenter' WHERE id='doc'");
 await db.query("UPDATE annotations SET deleted_at=now() WHERE id='ann_1'");
 expect(await ids()).toEqual([]);
});

it('acknowledges a rendered revision without hiding a newer one, and read-all clears every page',async()=>{
 await notify({id:'n',revision:2,once:false});
 await notify({id:'n',revision:3,once:false});
 expect((await membershipInbox(bob)).unread).toBe(1);
 expect((await updateMembershipInbox(bob,{read:'n',revision:2})).unread).toBe(1);
 expect((await updateMembershipInbox(bob,{read:'n',revision:3})).unread).toBe(0);
 // Someone else cannot acknowledge bob's row.
 await notify({id:'m'});expect((await updateMembershipInbox(alice,{read:'m',revision:1})).unread).toBe(0);
 expect((await membershipInbox(bob)).unread).toBe(1);
 await db.transaction(async tx=>{for(let i=0;i<55;i++)await recordNotification(tx,{id:`f${i}`,artifactId:null,recipientId:'bob',senderId:'carol',kind:'follow'});});
 const page=await membershipInbox(bob);
 expect([page.notifications.length,page.next,page.unread]).toEqual([50,50,56]);
 expect((await membershipInbox(bob,50)).notifications).toHaveLength(7);
 const cleared=await updateMembershipInbox(bob,{readAll:true});
 expect([cleared.unread,cleared.notifications.length]).toEqual([0,50]);
 expect((await db.query("SELECT 1 FROM event_outbox WHERE envelope->'payload'->>'change'='read'")).rows.length).toBe(58);
});

it('blocking hides the other person in both directions, dismisses invitations either initiated for the other, and unblocking restores',async()=>{
 await notify({id:'from-alice'});
 await db.transaction(tx=>recordEvent(tx,{kind:'user',id:'bob'},'join_requested',{kind:'artifact',id:'doc'},{user_id:'bob',revision:1}));
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility) VALUES('carols','t','carol','html','public')");
 await db.query(`INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by) VALUES
  ('user','bob','join','artifact','doc','pending','request','bob'),('user','bob','join','artifact','carols','pending','invitation','alice')`);
 const blocked=await updateMembershipInbox(bob,{block:'alice'});
 expect(blocked.notifications).toEqual([]);
 expect(blocked.blocks).toEqual([{user_id:'alice',username:'alice'}]);
 expect(await ids(alice)).toEqual([]);
 // Only what one of them initiated for the other is dismissed; bob's own request to alice's document stays pending.
 expect((await db.query("SELECT object_id,status FROM relations WHERE subject_id='bob' ORDER BY object_id")).rows).toEqual([{object_id:'carols',status:'dismissed'},{object_id:'doc',status:'pending'}]);
 expect((await updateMembershipInbox(bob,{block:'bob'})).blocks).toHaveLength(1);
 expect((await updateMembershipInbox(bob,{unblock:'alice'})).notifications.map(n=>n.id)).toEqual(['from-alice']);
 expect(await ids(alice)).toEqual(['doc:bob:1:request:alice']);
});

it('hides a dismissed invitation from its recipient',async()=>{
 await link('bob','follow','alice');
 await updateMembershipInbox(bob,{autoAccept:false});
 const row=(await getArtifactById('doc'))!;
 await db.transaction(tx=>invitePeople(tx,row,alice,['bob']));
 expect((await membershipInbox(bob)).notifications.map(n=>[n.kind,'status' in n?n.status:null])).toEqual([['invitation','pending']]);
 await changeMembership(bob,'doc',{action:'dismiss'});
 expect(await ids()).toEqual([]);
});

it('auto-accepts a mention from someone the recipient follows unless they turned that off',async()=>{
 const row=(await getArtifactById('doc'))!;
 await link('bob','follow','alice');await link('carol','follow','alice');
 expect((await membershipInbox(bob)).autoAccept).toBe(true);
 expect((await updateMembershipInbox(carol(),{autoAccept:false})).autoAccept).toBe(false);
 await db.transaction(tx=>invitePeople(tx,row,alice,['bob','carol'],'node:intro'));
 expect((await membershipInbox(bob)).notifications.map(n=>[n.kind,'status' in n?n.status:null])).toEqual([['joined','accepted']]);
 expect((await membershipInbox(carol())).notifications.map(n=>[n.kind,'status' in n?n.status:null])).toEqual([['invitation','pending']]);
 // A mention of someone who neither follows the sender nor belongs is refused outright.
 await db.query("INSERT INTO users(id,email,kind) VALUES('dave','dave@example.test','account')");
 await expect(db.transaction(tx=>invitePeople(tx,row,alice,['dave'],'node:other'))).rejects.toThrow('Person is not eligible for this invitation');
});
const carol=()=>identityForUser('carol',null,'carol@example.test');

it('lists a mutation run beside member notifications and reads it by id while the recipient stays joined',async()=>{
 await db.query("INSERT INTO notification_jobs(id,mutation_run_id,document_id,input) VALUES('job','run','doc',$1::jsonb)",[JSON.stringify({origin:{mutationName:'change'},bindings:{userId:'alice'}})]);
 await db.query("INSERT INTO mutation_notifications(id,job_id,mutation_run_id,recipient_id,artifact_id,initiator,messages,sources) VALUES('mn','job','run','bob','doc',$1::jsonb,'[\"Done\"]','[]')",[JSON.stringify({principal:{kind:'user',id:'alice'},execution:'human'})]);
 expect(await ids()).toEqual([]);
 await seedOwnerJoin(db,'doc','bob');
 const inbox=await membershipInbox(bob);
 expect(inbox.notifications).toEqual([expect.objectContaining({id:'mn',kind:'mutation',messages:['Done'],mutation_name:'change',actor:expect.objectContaining({kind:'user',userId:'alice',viaAgent:false})})]);
 expect((await updateMembershipInbox(bob,{read:'mn',revision:1})).unread).toBe(0);
});
