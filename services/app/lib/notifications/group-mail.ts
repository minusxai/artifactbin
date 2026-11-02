/** Durable group email delivery. Claims commit before provider calls; no PGLite work escapes a transaction. */
import type {Db} from '@/lib/platform';
import {notificationDelivery,type GroupEmail} from './delivery';
export async function flushGroupMail(db:Db):Promise<void>{
 const provider=notificationDelivery();if(!provider?.sendGroupEmail)return;
 const rows=await db.transaction(async tx=>(await tx.query<{id:string;email:string;recipient_id:string|null;group_id:string;group_name:string;handle:string;action:string;sender_id:string}>(`UPDATE group_mail_outbox SET lease_until=now()+interval '60 seconds' WHERE id IN (SELECT id FROM group_mail_outbox WHERE sent_at IS NULL AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,id LIMIT 25 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows);
 for(const row of rows){
  try{
   const blocked=row.recipient_id&&(await db.query('SELECT 1 FROM user_blocks WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)',[row.sender_id,row.recipient_id])).rows.length;
   const preferences=row.recipient_id?await provider.preferences(row.recipient_id):null;
   const eligible=!blocked&&(!preferences||(row.action==='invited'?preferences.invitations:preferences.activity));
   if(eligible){const message:GroupEmail={id:row.id,email:row.email,recipientId:row.recipient_id,groupId:row.group_id,groupName:row.group_name,handle:row.handle,action:row.action,senderId:row.sender_id};await provider.sendGroupEmail(message);}
   await db.query('UPDATE group_mail_outbox SET sent_at=now(),lease_until=NULL WHERE id=$1',[row.id]);
  }catch{await db.query('UPDATE group_mail_outbox SET lease_until=NULL WHERE id=$1',[row.id]);}
 }
}
export function startGroupMailDelivery(db:Db):()=>Promise<void>{
 let pending:Promise<void>|null=null;
 const tick=()=>pending??=flushGroupMail(db).catch(()=>{}).finally(()=>{pending=null;});
 const timer=setInterval(()=>void tick(),1000);timer.unref();
 return async()=>{clearInterval(timer);await pending;};
}
