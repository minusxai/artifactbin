/** Storage-side lifecycle helpers; never reach outside the supplied transaction. */
import type {Queryable} from '@artifactbin/contracts';

/** ACL additions have no existing row to lock. Keep this short fence ordered across writers. */
export async function lockMutationNotificationAuthority(tx:Queryable,mode:'read'|'write'='read'):Promise<void>{
 await tx.query(`LOCK TABLE artifact_shares, artifacts, dataset_secrets, relations, tokens, user_blocks, users IN ${mode==='read'?'SHARE':'SHARE ROW EXCLUSIVE'} MODE`);
}

/** Disposable-account erasure also removes immutable job arguments and pending envelopes. */
export async function eraseMutationNotifications(tx:Queryable,userId:string,artifactIds:string[]):Promise<void>{
 const jobs=(await tx.query<{id:string}>(`SELECT id FROM notification_jobs WHERE document_id=ANY($2::text[])
   OR input->'initiator'->'principal'->>'kind'='user' AND input->'initiator'->'principal'->>'id'=$1
   OR input->'initiator'->'principal'->>'kind'='token' AND input->'initiator'->'principal'->>'id' IN (SELECT id FROM tokens WHERE user_id=$1)
   OR input->'bindings'->>'userId'=$1`,[userId,artifactIds])).rows.map(row=>row.id);
 const removed=(await tx.query<{id:string}>('DELETE FROM mutation_notifications WHERE recipient_id=$1 OR artifact_id=ANY($2::text[]) OR job_id=ANY($3::text[]) RETURNING id',[userId,artifactIds,jobs])).rows.map(row=>row.id);
 if(removed.length)await tx.query("DELETE FROM event_outbox WHERE envelope->>'verb'='notification_changed' AND envelope->'payload'->>'notification_id'=ANY($1::text[])",[removed]);
 await tx.query('DELETE FROM notification_jobs WHERE id=ANY($1::text[])',[jobs]);
}
