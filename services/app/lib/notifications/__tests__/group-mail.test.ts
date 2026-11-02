import {afterEach,expect,it,vi} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {flushGroupMail,setNotificationDelivery} from '..';
import type {GroupEmail} from '../delivery';
useAppHarness();
afterEach(()=>{setNotificationDelivery(undefined);vi.useRealTimers();});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
async function seed(id='mail',recipient:string|null=null){
 const db=await getDb();
 await db.query(`INSERT INTO group_mail_outbox(id,email,recipient_id,group_id,group_name,handle,action,sender_id) VALUES($1,'invite@example.test',$2,'g','Group','group','invited','sender')`,[id,recipient]);
 return db;
}
function delivery(send:(message:GroupEmail)=>Promise<void>,preferences=async(_id:string)=>({invitations:true,activity:true,comments:true})){
 setNotificationDelivery({sendGroupEmail:send,preferences,updatePreferences:async(_id,p)=>p,click:async()=>null});
}
it('schedules rejected mail away from due work, delivers the 26th and quarantines bounded failures',async()=>{
 const db=await seed('00');
 for(let i=1;i<26;i++)await seed(String(i).padStart(2,'0'));
 const send=vi.fn(async(m:GroupEmail)=>{if(m.id!=='25')throw Error('disabled');});delivery(send);
 await flushGroupMail(db);await flushGroupMail(db);
 expect(send.mock.calls.filter(([m])=>m.id==='25')).toHaveLength(1);
 expect(send).toHaveBeenCalledTimes(26);
 expect((await db.query('SELECT attempts FROM group_mail_outbox WHERE id=$1',['00'])).rows).toEqual([{attempts:1}]);
 for(let n=1;n<8;n++){await db.query("UPDATE group_mail_outbox SET next_attempt_at=now()-interval '1 second' WHERE sent_at IS NULL");await flushGroupMail(db);}
 expect((await db.query('SELECT 1 FROM group_mail_outbox WHERE quarantined_at IS NOT NULL')).rows).toHaveLength(25);
 const count=send.mock.calls.length;await flushGroupMail(db);expect(send).toHaveBeenCalledTimes(count);
 expect(new Set(send.mock.calls.filter(([m])=>m.id==='00').map(([m])=>m.id)).size).toBe(1);
});
for(const outcome of ['success','failure'])it(`fences stale ${outcome} from the newer claim`,async()=>{
 const db=await seed();const firstEntered=deferred(),firstFinish=deferred(),secondEntered=deferred(),secondFinish=deferred();let calls=0;
 delivery(async()=>{if(++calls===1){firstEntered.resolve();await firstFinish.promise;if(outcome==='failure')throw Error('old failure');}else{secondEntered.resolve();await secondFinish.promise;}});
 const first=flushGroupMail(db);await firstEntered.promise;
 await db.query("UPDATE group_mail_outbox SET lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second'");
 const second=flushGroupMail(db);await secondEntered.promise;
 const claimed=(await db.query('SELECT lease_until FROM group_mail_outbox')).rows;
 firstFinish.resolve();await first;
 expect((await db.query('SELECT lease_until FROM group_mail_outbox')).rows).toEqual(claimed);
 expect((await db.query('SELECT sent_at FROM group_mail_outbox')).rows).toEqual([{sent_at:null}]);
 secondFinish.resolve();await second;
 expect((await db.query('SELECT 1 FROM group_mail_outbox WHERE sent_at IS NOT NULL')).rows).toHaveLength(1);
});
for(const policy of ['preferences','block'])it(`resolves a newly registered invitee and honors current ${policy}`,async()=>{
 const db=await seed();await db.query("INSERT INTO users(id,email) VALUES('sender','sender@example.test'),('new','invite@example.test')");
 if(policy==='block')await db.query("INSERT INTO user_blocks(user_id,blocked_user_id) VALUES('new','sender')");
 const send=vi.fn(async()=>{}),preferences=vi.fn(async(_id:string)=>({invitations:policy!=='preferences',activity:true,comments:true}));delivery(send,preferences);
 await flushGroupMail(db);expect(send).not.toHaveBeenCalled();
 if(policy==='preferences')expect(preferences).toHaveBeenCalledWith('new');
});
it('does not send an account-bound message to a reassigned address',async()=>{
 const db=await seed('mail','old');await db.query("INSERT INTO users(id,email) VALUES('old','other@example.test'),('new','invite@example.test')");
 const send=vi.fn(async()=>{});delivery(send);await flushGroupMail(db);expect(send).not.toHaveBeenCalled();
});
it('claims just before processing and bounds external work without clearing a successor',async()=>{
 const db=await seed('first');await seed('second');const entered=deferred(),finish=deferred();
 const send=vi.fn(async(m:GroupEmail)=>{if(m.id==='first'){entered.resolve();await finish.promise;}});delivery(send);
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const flush=flushGroupMail(db);await entered.promise;
 expect((await db.query("SELECT attempts,lease_until FROM group_mail_outbox WHERE id='second'")).rows).toEqual([{attempts:0,lease_until:null}]);
 await vi.advanceTimersByTimeAsync(20_000);await flush;
 expect(send).toHaveBeenCalledTimes(2);
 expect((await db.query("SELECT attempts,sent_at,lease_until FROM group_mail_outbox WHERE id='first'")).rows).toEqual([{attempts:1,sent_at:null,lease_until:null}]);
 finish.resolve();await Promise.resolve();
 expect((await db.query("SELECT sent_at FROM group_mail_outbox WHERE id='first'")).rows).toEqual([{sent_at:null}]);
});
it('pins a newly registered account across failed attempts and suppresses later reassignment',async()=>{
 const db=await seed();await db.query("INSERT INTO users(id,email) VALUES('new','invite@example.test')");
 const send=vi.fn(async()=>{throw Error('disabled');});delivery(send);await flushGroupMail(db);
 expect((await db.query('SELECT recipient_id FROM group_mail_outbox')).rows).toEqual([{recipient_id:'new'}]);
 await db.query("UPDATE users SET email='other@example.test' WHERE id='new'");
 await db.query("INSERT INTO users(id,email) VALUES('replacement','invite@example.test')");
 await db.query("UPDATE group_mail_outbox SET next_attempt_at=now()-interval '1 second'");
 await flushGroupMail(db);expect(send).toHaveBeenCalledTimes(1);
});
it('delivers to genuinely unregistered invitation addresses',async()=>{
 const db=await seed();const send=vi.fn(async()=>{});delivery(send);await flushGroupMail(db);
 expect(send).toHaveBeenCalledWith(expect.objectContaining({id:'mail',recipientId:null,email:'invite@example.test'}));
});
it('quarantines an exhausted expired claim after a crashed worker',async()=>{
 const db=await seed();await db.query("UPDATE group_mail_outbox SET attempts=8,claim_token='crashed',lease_until=now()-interval '1 second'");
 const send=vi.fn(async()=>{});delivery(send);await flushGroupMail(db);expect(send).not.toHaveBeenCalled();
 expect((await db.query('SELECT 1 FROM group_mail_outbox WHERE quarantined_at IS NOT NULL AND claim_token IS NULL')).rows).toHaveLength(1);
});
it('commits the claim before provider work and never holds the PGLite transaction across it',async()=>{
 const db=await seed();
 delivery(async()=>{await db.transaction(async tx=>{
  expect((await tx.query('SELECT attempts FROM group_mail_outbox WHERE claim_token IS NOT NULL')).rows).toEqual([{attempts:1}]);
 });});
 await flushGroupMail(db);
 expect((await db.query('SELECT 1 FROM group_mail_outbox WHERE sent_at IS NOT NULL')).rows).toHaveLength(1);
});
it('bounds a stalled preference lookup and never sends when it later resolves',async()=>{
 const db=await seed('mail','recipient');await db.query("INSERT INTO users(id,email) VALUES('recipient','invite@example.test')");
 const entered=deferred(),finish=deferred(),send=vi.fn(async()=>{});
 delivery(send,async()=>{entered.resolve();await finish.promise;return {invitations:true,activity:true,comments:true};});
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const flush=flushGroupMail(db);await entered.promise;
 await vi.advanceTimersByTimeAsync(20_000);await flush;finish.resolve();await Promise.resolve();
 expect(send).not.toHaveBeenCalled();
 expect((await db.query('SELECT sent_at,lease_until,attempts FROM group_mail_outbox')).rows).toEqual([{sent_at:null,lease_until:null,attempts:1}]);
});
