/**
 * The one event-to-notification policy (recordEvent): which facts reach whose inbox, under which
 * stable id, and which only re-announce rows that already exist. Every assertion reads committed
 * rows (member_notifications, event_outbox), never the projection's statements.
 */
import {beforeEach,expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {notificationChannel,recordEvent} from '@/lib/notifications';

useAppHarness();
type Db=Awaited<ReturnType<typeof getDb>>;
let db:Db;
beforeEach(async()=>{
 db=await getDb();
 await db.query(`INSERT INTO users(id,email) VALUES('alice','alice@example.test'),('bob','bob@example.test'),('carol','carol@example.test'),
  ('dave','dave@example.test'),('erin','erin@example.test'),('frank','frank@example.test')`);
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility) VALUES('doc','t','alice','html','public')");
});
/** Any verb on any object kind: the projection, not the typed producer, is under test. */
const record=recordEvent as (...args:[Parameters<typeof recordEvent>[0],{kind:'user';id:string}|null,string,{kind:'artifact'|'user';id:string},Record<string,unknown>])=>Promise<void>;
const emit=(sender:string|null,verb:string,object:{kind:'artifact'|'user';id:string},payload:Record<string,unknown>={})=>
 db.transaction(tx=>record(tx,sender?{kind:'user',id:sender}:null,verb,object,payload));
const inbox=async()=>(await db.query<{id:string;recipient_id:string;kind:string;user_id:string;source:string|null;revision:number}>('SELECT id,recipient_id,kind,user_id,source,revision FROM member_notifications ORDER BY id')).rows;
const changes=async(change?:string)=>(await db.query<{id:string;to:string;change:string}>(`SELECT envelope->'payload'->>'notification_id' AS id,envelope->>'object_id' AS "to",envelope->'payload'->>'change' AS change FROM event_outbox WHERE envelope->>'verb'='notification_changed' ${change?"AND envelope->'payload'->>'change'=$1":''} ORDER BY created_at,id`,change?[change]:[])).rows;

it('records a like for the owner once, never for the liker themselves or across a block',async()=>{
 await emit('bob','liked',{kind:'artifact',id:'doc'});
 await emit('bob','liked',{kind:'artifact',id:'doc'});
 await emit('alice','liked',{kind:'artifact',id:'doc'});
 await emit(null,'liked',{kind:'artifact',id:'doc'});
 expect(await inbox()).toEqual([{id:'social:like:bob:doc',recipient_id:'alice',kind:'like',user_id:'alice',source:null,revision:1}]);
 expect(await changes()).toEqual([{id:'social:like:bob:doc',to:'alice',change:'updated'}]);
 await db.query("INSERT INTO user_blocks(user_id,blocked_user_id) VALUES('alice','carol'),('dave','alice')");
 await emit('carol','liked',{kind:'artifact',id:'doc'});
 await emit('alice','followed',{kind:'user',id:'dave'});
 expect(await inbox()).toHaveLength(1);
 // Every fact is still recorded even when nobody is notified.
 expect((await db.query("SELECT 1 FROM event_outbox WHERE envelope->>'verb' IN ('liked','followed')")).rows).toHaveLength(6);
});

it('records a follow for the followed user, without an artifact',async()=>{
 await emit('bob','followed',{kind:'user',id:'carol'});
 expect(await inbox()).toEqual([{id:'social:follow:bob:carol',recipient_id:'carol',kind:'follow',user_id:'carol',source:null,revision:1}]);
 expect((await db.query('SELECT artifact_id FROM member_notifications')).rows).toEqual([{artifact_id:null}]);
});

it('sends a join request to the owner and every editor share, by account or by unclaimed email, not to viewers',async()=>{
 await db.query(`INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES('doc','dave','dave@example.test','editor'),
  ('doc',NULL,'erin@example.test','editor'),('doc','frank','frank@example.test','viewer'),('doc','carol','carol@example.test','editor')`);
 await emit('carol','join_requested',{kind:'artifact',id:'doc'},{user_id:'carol',revision:2});
 expect((await inbox()).map(n=>[n.recipient_id,n.id,n.kind,n.user_id])).toEqual([
  ['alice','doc:carol:2:request:alice','request','carol'],
  ['dave','doc:carol:2:request:dave','request','carol'],
  ['erin','doc:carol:2:request:erin','request','carol'],
 ]);
});

it('keys invitations by revision and mentions by their source, folding a comment mention into its conversation',async()=>{
 await emit('alice','invited',{kind:'artifact',id:'doc'},{user_id:'bob',revision:1});
 await emit('alice','invited',{kind:'artifact',id:'doc'},{user_id:'bob',revision:1});
 await emit('alice','mentioned',{kind:'artifact',id:'doc'},{user_id:'carol',revision:3,mention_ref:'comment:ann_1'});
 await emit('alice','mentioned',{kind:'artifact',id:'doc'},{user_id:'dave',revision:3,mention_ref:'node:intro'});
 await emit('alice','mentioned',{kind:'artifact',id:'doc'},{user_id:'alice',revision:1,mention_ref:'node:self'});
 expect((await inbox()).map(n=>[n.id,n.kind,n.source])).toEqual([
  ['doc:bob:1:invitation:bob','invitation',null],
  ['doc:dave:node:intro','mention','node:intro'],
  ['thread:ann_1:carol','mention','comment:ann_1'],
 ]);
});

it('re-announces existing membership rows on join, leave and dismissal; only a join is itself news',async()=>{
 await emit('alice','invited',{kind:'artifact',id:'doc'},{user_id:'bob',revision:1});
 const before=(await changes()).length;
 await emit('bob','left',{kind:'artifact',id:'doc'},{user_id:'bob',revision:2});
 await emit('bob','invitation_dismissed',{kind:'artifact',id:'doc'},{user_id:'bob',revision:3});
 expect(await inbox()).toHaveLength(1);
 expect((await changes()).slice(before)).toEqual([{id:'doc:bob:1:invitation:bob',to:'bob',change:'updated'},{id:'doc:bob:1:invitation:bob',to:'bob',change:'updated'}]);
 await emit('alice','joined',{kind:'artifact',id:'doc'},{user_id:'bob',revision:4});
 expect((await inbox()).map(n=>n.id)).toEqual(['doc:bob:1:invitation:bob','doc:bob:4:joined:bob']);
 // A self-join announces the existing rows but notifies nobody new.
 await emit('carol','joined',{kind:'artifact',id:'doc'},{user_id:'carol',revision:1});
 expect(await inbox()).toHaveLength(2);
});

it('notifies a conversation on replies, resolution and reopening, coalescing an unread reply with its resolution',async()=>{
 await db.query(`INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id,revision) VALUES
  ('ann_root','doc',NULL,'Question','human','bob',1),('ann_reply','doc','ann_root','Answer','human','carol',1)`);
 await emit('carol','annotated',{kind:'artifact',id:'doc'},{annotation_id:'ann_root'});
 expect(await inbox()).toEqual([]);
 await emit('carol','annotated',{kind:'artifact',id:'doc'},{annotation_id:'ann_root',reply_id:'ann_reply'});
 expect((await inbox()).map(n=>[n.id,n.kind,n.source])).toEqual([['thread:ann_root:bob','reply','comment:ann_root']]);
 await db.query("UPDATE annotations SET revision=2 WHERE id='ann_root'");
 await emit('carol','annotation_resolved',{kind:'artifact',id:'doc'},{annotation_id:'ann_root'});
 expect((await inbox()).map(n=>[n.id,n.kind,n.revision])).toEqual([['thread:ann_root:bob','reply_resolved',2]]);
 await db.query("UPDATE member_notifications SET read_at=now()");
 await db.query("UPDATE annotations SET revision=3 WHERE id='ann_root'");
 await emit('carol','annotation_reopened',{kind:'artifact',id:'doc'},{annotation_id:'ann_root'});
 expect((await db.query('SELECT kind,revision,read_at FROM member_notifications')).rows).toEqual([{kind:'reopened',revision:3,read_at:null}]);
 // An agent reply reaches its own account; a human never notifies themselves.
 await db.query("INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id) VALUES('ann_agent','doc','ann_root','Done','agent','alice')");
 await emit('alice','annotated',{kind:'artifact',id:'doc'},{annotation_id:'ann_root',reply_id:'ann_agent',agent:true});
 expect((await db.query<{recipient_id:string;agent_label:string|null}>('SELECT recipient_id,agent_label FROM member_notifications ORDER BY recipient_id')).rows)
  .toEqual([{recipient_id:'alice',agent_label:'Agent'},{recipient_id:'bob',agent_label:'Agent'},{recipient_id:'carol',agent_label:'Agent'}]);
});

it('removes a deleted conversation from every inbox through removal events, with no actor needed',async()=>{
 await db.query("INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id) VALUES('ann_root','doc',NULL,'Q','human','bob'),('ann_reply','doc','ann_root','A','human','carol')");
 await emit('carol','annotated',{kind:'artifact',id:'doc'},{annotation_id:'ann_root',reply_id:'ann_reply'});
 await emit('alice','mentioned',{kind:'artifact',id:'doc'},{user_id:'dave',revision:1,mention_ref:'comment:ann_root'});
 await emit(null,'annotation_deleted',{kind:'artifact',id:'doc'},{annotation_id:'ann_root'});
 expect((await changes('removed')).map(c=>c.id).sort()).toEqual(['thread:ann_root:bob','thread:ann_root:dave']);
});

it('never lets a test account reach a real account, and commits nothing when the source action rolls back',async()=>{
 await db.query("UPDATE users SET test_account=true WHERE id='bob'");
 await emit('bob','liked',{kind:'artifact',id:'doc'});
 expect(await inbox()).toEqual([]);
 await db.query("UPDATE users SET test_account=true WHERE id='alice'");
 await emit('bob','liked',{kind:'artifact',id:'doc'});
 expect((await inbox()).map(n=>n.recipient_id)).toEqual(['alice']);
 await expect(db.transaction(async tx=>{await recordEvent(tx,{kind:'user',id:'carol'},'followed',{kind:'user',id:'dave'},{});throw Error('rollback');})).rejects.toThrow('rollback');
 expect((await inbox()).map(n=>n.recipient_id)).toEqual(['alice']);
 expect((await db.query("SELECT 1 FROM event_outbox WHERE envelope->>'object_id'='dave'")).rows).toEqual([]);
});

it('names a stable, private wakeup channel per recipient',()=>{
 expect(notificationChannel('alice')).toMatch(/^inbox_[0-9a-f]{32}$/);
 expect(notificationChannel('alice')).toBe(notificationChannel('alice'));
 expect(notificationChannel('alice')).not.toBe(notificationChannel('bob'));
 expect(notificationChannel('alice')).not.toContain('alice');
});
