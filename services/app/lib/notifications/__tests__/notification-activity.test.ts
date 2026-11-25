import {recordEvent} from '@/lib/platform';
import { identityForUser } from '@/lib/accounts';
import { link } from '@/lib/social';
import {actOnAnnotationFor,deleteAnnotationFor} from '@/lib/annotations';
import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import { createUser } from '@/lib/accounts/testing';
import { membershipInbox, updateMembershipInbox } from '@/lib/notifications';
import { seedArtifacts, setArtifact } from '@/__tests__/rows';
useAppHarness();
it('coalesces an agent reply and resolution, including its own account, and notifies reopening',async()=>{
 const owner=await createUser({email:'mxmx_test_notify_agent@example.com'});
 const db=await getDb();
 await seedArtifacts(db, { id: 'thread1', token_id: 't', user_id: owner.id, format: 'html', source: '<!doctype html><html><body><p data-af-id="note">Hello</p></body></html>', visibility: 'public' });
 await db.query("INSERT INTO annotations(id,artifact_id,body,author_kind,author_user_id,author_token_id,status,snippet) VALUES('ann_thread','thread1','Please fix','human',$1,'t','open','')",[owner.id]);
 const actor=identityForUser(owner.id, 't');
 const result=await actOnAnnotationFor(actor,'thread1','ann_thread',{reply:'Fixed it',resolve:true},{kind:'agent',label:'helper',transport:'http'});
 expect(result?.status).toBe('resolved');
 let inbox=await membershipInbox(actor);
 expect(inbox.notifications).toHaveLength(1);expect(inbox.notifications[0]?.kind).toBe('reply_resolved');
 expect(inbox.notifications[0]?.revision).toBe(result?.revision);
 await updateMembershipInbox(actor,{read:inbox.notifications[0]!.id,revision:result!.revision});
 await actOnAnnotationFor(actor,'thread1','ann_thread',{reopen:true},{kind:'agent',label:'helper',transport:'http'});
 inbox=await membershipInbox(actor);expect(inbox.unread).toBe(1);expect(inbox.notifications[0]?.kind).toBe('reopened');
});

it('keeps a mention and subsequent replies in one conversation item and hides deleted threads',async()=>{
 const alice=await createUser({email:'mxmx_test_thread_a@example.com'}),bob=await createUser({email:'mxmx_test_thread_b@example.com'});
 const db=await getDb();
 await seedArtifacts(db, { id: 'thread2', token_id: 't', user_id: alice.id, format: 'html', source: '<!doctype html><html><body><p data-af-id="note">Hello</p></body></html>', visibility: 'public' });
 await db.query("INSERT INTO annotations(id,artifact_id,body,author_kind,author_user_id,author_token_id,status,snippet) VALUES('ann_mentions','thread2','Please fix','human',$1,'t','open','')",[alice.id]);
 await db.query("INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by) VALUES('user',$1,'join','artifact','thread2','accepted','invitation',$2)",[bob.id,alice.id]);
 await setArtifact(db, 'thread2', { link_role: 'commenter' });
 const actor=identityForUser(alice.id, 't'),recipient=identityForUser(bob.id, null);
 await actOnAnnotationFor(actor,'thread2','ann_mentions',{reply:`Hi [@bob](/people/${bob.id})`},{kind:'human',label:null,transport:'http'});
 await actOnAnnotationFor(actor,'thread2','ann_mentions',{reply:'Another update',resolve:true},{kind:'human',label:null,transport:'http'});
 const inbox=await membershipInbox(recipient);
 expect(inbox.notifications).toHaveLength(1);
 expect(inbox.notifications[0]).toMatchObject({id:`thread:ann_mentions:${bob.id}`,source:'comment:ann_mentions',kind:'reply_resolved'});
 await setArtifact(db, 'thread2', { link_role: 'viewer' });
 expect((await membershipInbox(recipient)).notifications).toEqual([]);
 await setArtifact(db, 'thread2', { link_role: 'commenter' });
 expect(await deleteAnnotationFor(actor,'thread2','ann_mentions')).toBe(true);
 expect((await db.query("SELECT envelope FROM event_outbox WHERE envelope->'payload'->>'change'='removed'")).rows).toHaveLength(1);
 expect((await membershipInbox(recipient)).notifications).toEqual([]);
});

it('records the source event and derives a recipient notification in the same transaction',async()=>{
 const alice=await createUser({email:'mxmx_test_source_a@example.com'}),bob=await createUser({email:'mxmx_test_source_b@example.com'});
 const db=await getDb();
 await link(alice.id,'follow',bob.id);
 const facts=(await db.query<{id:string}>("SELECT id FROM event_outbox WHERE envelope->>'verb'='followed'")).rows;
 expect(facts).toHaveLength(1);
 expect((await db.query('SELECT source_event_id FROM member_notifications WHERE recipient_id=$1',[bob.id])).rows).toEqual([{source_event_id:facts[0]!.id}]);
 await link(alice.id,'follow',bob.id);
 expect((await db.query("SELECT id FROM event_outbox WHERE envelope->>'verb'='followed'")).rows).toHaveLength(1);
});

it('rolls back a source fact and its notification together; unrelated facts stay silent',async()=>{
 const alice=await createUser({email:'mxmx_test_atomic_a@example.com'}),bob=await createUser({email:'mxmx_test_atomic_b@example.com'}),db=await getDb();
 await expect(db.transaction(async tx=>{await recordEvent(tx,{kind:'user',id:alice.id},'followed',{kind:'user',id:bob.id},{});throw Error('rollback');})).rejects.toThrow('rollback');
 expect((await db.query('SELECT id FROM event_outbox')).rows).toEqual([]);
 expect((await db.query('SELECT id FROM member_notifications')).rows).toEqual([]);
 await db.transaction(tx=>recordEvent(tx,{kind:'user',id:alice.id},'edited',{kind:'artifact',id:'doc'},{}));
 expect((await db.query('SELECT id FROM event_outbox')).rows).toHaveLength(1);
 expect((await db.query('SELECT id FROM member_notifications')).rows).toEqual([]);
});
