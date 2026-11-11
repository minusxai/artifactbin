/**
 * Durable group email delivery from the identity module's outbox (`claimGroupMail`/`settleGroupMail`): this side
 * decides eligibility (current address holder, preferences, blocks) and calls the provider. Claims commit before
 * external calls; no provider runs in a transaction.
 */
import {services,type Db} from '@/lib/platform';
import {notificationDelivery,type GroupEmail} from './delivery';

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
 const identity=services().identity;
 for(let i=0;i<25;i++){
  // The claim commits (in the identity module, the outbox's owner) before any external call.
  const row=await identity.claimGroupMail({leaseSeconds:LEASE_SECONDS,maxAttempts:MAX_ATTEMPTS});
  if(!row)return;
  const token=row.claim_token;
  // Every transition is fenced by claim AND unexpired lease. An old worker can neither release
  // nor complete a successor's claim, even if its delayed provider call eventually settles.
  const settle=(outcome:'pin'|'sent'|'failed',recipientId?:string)=>identity.settleGroupMail({id:row.id,claimToken:token,outcome,maxAttempts:MAX_ATTEMPTS,...(recipientId?{recipientId}:{})});
  try{
   let recipient=row.recipient_id;
   const current=(await db.query<{id:string}>("SELECT id FROM users WHERE email=$1 AND kind='account'",[row.email])).rows[0]?.id??null;
   if(!recipient&&row.action==='invited'&&current){
    recipient=current;
    // Pin the newly resolved identity so retries cannot follow a subsequently reassigned address.
    await settle('pin',recipient);
   }
   let eligible=recipient?recipient===current:!current;
   const preferences=eligible&&recipient?await bounded(()=>provider.preferences(recipient!)):null;
   eligible=eligible&&(!preferences||(row.action==='invited'?preferences.invitations:preferences.activity));
   if(eligible){
    // Recheck identity/blocks after the external preference lookup, immediately before sending.
    const identityNow=(await db.query<{id:string}>("SELECT id FROM users WHERE email=$1 AND kind='account'",[row.email])).rows[0]?.id??null;
    const blocked=recipient&&(await db.query('SELECT 1 FROM user_blocks WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)',[row.sender_id,recipient])).rows.length;
    eligible=identityNow===recipient&&!blocked;
   }
   if(eligible&&(await db.query('SELECT 1 FROM group_mail_outbox WHERE id=$1 AND claim_token=$2 AND lease_until>now()',[row.id,token])).rows.length){
    const message:GroupEmail={id:row.id,email:row.email,recipientId:recipient,groupId:row.group_id,groupName:row.group_name,handle:row.handle,action:row.action,senderId:row.sender_id};
    await bounded(()=>provider.sendGroupEmail!(message));
   }
   await settle('sent');
  }catch{
   await settle('failed').catch(()=>{});
  }
 }
}
export function startGroupMailDelivery(db:Db):()=>Promise<void>{
 let pending:Promise<void>|null=null;
 const tick=()=>pending??=flushGroupMail(db).catch(()=>{}).finally(()=>{pending=null;});
 const timer=setInterval(()=>void tick(),1000);timer.unref();
 return async()=>{clearInterval(timer);await pending;};
}
