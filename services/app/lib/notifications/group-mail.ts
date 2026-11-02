/** Durable group email delivery. Claims commit before external calls; no provider runs in a transaction. */
import {randomUUID} from 'node:crypto';
import type {Db} from '@/lib/platform';
import {notificationDelivery,type GroupEmail} from './delivery';

interface MailRow {id:string;email:string;recipient_id:string|null;group_id:string;group_name:string;handle:string;action:string;sender_id:string;attempts:number}
// Each attempt owns one short lease, not a preclaimed sequential batch. Count claims (including
// crashed workers), space retries exponentially, and quarantine after eight attempts for inspection.
// The provider id is the outbox id, NEVER the claim token: a timed-out call may still complete
// externally, so adapters must forward that stable idempotency key on every attempt.
const MAX_ATTEMPTS=8;
const LEASE_SECONDS=60;
const EXTERNAL_MS=20_000;
async function bounded<T>(work:()=>Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Group mail deadline exceeded')),EXTERNAL_MS);})]);}
 finally{if(timer)clearTimeout(timer);}
}
export async function flushGroupMail(db:Db):Promise<void>{
 const provider=notificationDelivery();if(!provider?.sendGroupEmail)return;
 for(let i=0;i<25;i++){
  const token=randomUUID();
  const row=await db.transaction(async tx=>{
   // Exhausted crashed claims must not remain due forever either.
   await tx.query(`UPDATE group_mail_outbox SET quarantined_at=now(),claim_token=NULL,lease_until=NULL WHERE sent_at IS NULL AND quarantined_at IS NULL AND attempts >= $1 AND (lease_until IS NULL OR lease_until<now())`,[MAX_ATTEMPTS]);
   return (await tx.query<MailRow>(`UPDATE group_mail_outbox SET claim_token=$1,lease_until=now()+$2*interval '1 second',attempts=attempts+1,
    next_attempt_at=now()+LEAST(3600,60*power(2,attempts))*interval '1 second'
    WHERE id IN (SELECT id FROM group_mail_outbox WHERE sent_at IS NULL AND quarantined_at IS NULL AND attempts<$3 AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,[token,LEASE_SECONDS,MAX_ATTEMPTS])).rows[0];
  });
  if(!row)return;
  // Every transition is fenced by claim AND unexpired lease. An old worker can neither release
  // nor complete a successor's claim, even if its delayed provider call eventually settles.
  const owned='id=$1 AND claim_token=$2 AND lease_until>now()';
  try{
   let recipient=row.recipient_id;
   const current=(await db.query<{id:string}>("SELECT id FROM users WHERE email=$1 AND kind='account'",[row.email])).rows[0]?.id??null;
   if(!recipient&&row.action==='invited'&&current){
    recipient=current;
    // Pin the newly resolved identity so retries cannot follow a subsequently reassigned address.
    await db.query(`UPDATE group_mail_outbox SET recipient_id=$3 WHERE ${owned}`,[row.id,token,recipient]);
   }
   let eligible=recipient?recipient===current:!current;
   const preferences=eligible&&recipient?await bounded(()=>provider.preferences(recipient!)):null;
   eligible=eligible&&(!preferences||(row.action==='invited'?preferences.invitations:preferences.activity));
   if(eligible){
    // Recheck identity/blocks after the external preference lookup, immediately before sending.
    const identity=(await db.query<{id:string}>("SELECT id FROM users WHERE email=$1 AND kind='account'",[row.email])).rows[0]?.id??null;
    const blocked=recipient&&(await db.query('SELECT 1 FROM user_blocks WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)',[row.sender_id,recipient])).rows.length;
    eligible=identity===recipient&&!blocked;
   }
   if(eligible&&(await db.query(`SELECT 1 FROM group_mail_outbox WHERE ${owned}`,[row.id,token])).rows.length){
    const message:GroupEmail={id:row.id,email:row.email,recipientId:recipient,groupId:row.group_id,groupName:row.group_name,handle:row.handle,action:row.action,senderId:row.sender_id};
    await bounded(()=>provider.sendGroupEmail!(message));
   }
   await db.query(`UPDATE group_mail_outbox SET sent_at=now(),lease_until=NULL,claim_token=NULL WHERE ${owned}`,[row.id,token]);
  }catch{
   await db.query(`UPDATE group_mail_outbox SET lease_until=NULL,claim_token=NULL,quarantined_at=CASE WHEN attempts >= $3 THEN now() ELSE NULL END WHERE ${owned}`,[row.id,token,MAX_ATTEMPTS]);
  }
 }
}
export function startGroupMailDelivery(db:Db):()=>Promise<void>{
 let pending:Promise<void>|null=null;
 const tick=()=>pending??=flushGroupMail(db).catch(()=>{}).finally(()=>{pending=null;});
 const timer=setInterval(()=>void tick(),1000);timer.unref();
 return async()=>{clearInterval(timer);await pending;};
}
