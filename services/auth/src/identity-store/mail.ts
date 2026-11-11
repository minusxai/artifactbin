/**
 * THE GROUP MAIL OUTBOX (`group_mail_outbox`): the mail a group change sends, written in the change's own transaction
 * so a committed change never loses its mail and a rolled-back one never sends any. Delivery is the app's (its
 * provider, the reader's preferences and blocks, rechecked just before sending, lib/notifications group-mail); the
 * row's lifecycle stays here: a claim is one short lease, every later transition is fenced by claim AND unexpired
 * lease, retries back off exponentially, and a row is quarantined after `maxAttempts`.
 *
 * Who is mailed: the accounts a change concerns, and for an invitation the invited address (as the account holding
 * it, or the bare address when there is none). Never the actor, and nobody when a test account acts.
 */
import {randomUUID} from 'node:crypto';
import type {GroupChange,GroupMailClaim,IdentityService,Queryable,TransactionalQueryable} from '@artifactbin/contracts';
import type {IdentityTables} from './tables';

export async function enqueueGroupMail(q: Queryable, t: IdentityTables, change: GroupChange): Promise<void> {
  const sender = change.actorId;
  if ((await q.query(`SELECT 1 FROM ${t.users} WHERE id=$1 AND test_account`, [sender])).rows.length) return;
  const recipients = new Set(change.recipients);
  const addresses = new Map<string, string | null>();
  if (typeof change.details.invitation_id === 'string') {
    const invite = (await q.query<{email: string}>(`SELECT email FROM ${t.group_invitations} WHERE id=$1`, [change.details.invitation_id])).rows[0];
    if (invite) {
      const holders = (await q.query<{id: string}>(`SELECT id FROM ${t.users} WHERE email=$1 AND kind='account'`, [invite.email])).rows;
      if (!holders.length) addresses.set(invite.email, null);
      for (const holder of holders) recipients.add(holder.id);
    }
  }
  recipients.delete(sender);
  if (recipients.size) for (const row of (await q.query<{id: string; email: string | null}>(`SELECT id,email FROM ${t.users} WHERE id=ANY($1::text[]) ORDER BY id`, [[...recipients]])).rows)
    if (row.email) addresses.set(row.email, row.id);
  if (!addresses.size) return;
  const group = (await q.query<{name: string; handle: string}>(`SELECT name,handle FROM ${t.groups} WHERE id=$1`, [change.groupId])).rows[0];
  if (!group) return;
  for (const [email, recipient] of addresses)
    await q.query(`INSERT INTO ${t.group_mail_outbox}(id,email,recipient_id,group_id,group_name,handle,action,sender_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [`group:${change.id}:${email}`, email, recipient, change.groupId, group.name, group.handle, change.action, sender]);
}

export function mailMethods(db: TransactionalQueryable, t: IdentityTables): Pick<IdentityService, 'enqueueGroupMail' | 'claimGroupMail' | 'settleGroupMail'> {
  const owned = 'id=$1 AND claim_token=$2 AND lease_until>now()';
  return {
    enqueueGroupMail: ({change}) => db.transaction(tx => enqueueGroupMail(tx, t, change)),
    async claimGroupMail({leaseSeconds, maxAttempts}): Promise<GroupMailClaim | null> {
      const token = randomUUID();
      return db.transaction(async tx => {
        // Exhausted crashed claims must not stay due forever either.
        await tx.query(`UPDATE ${t.group_mail_outbox} SET quarantined_at=now(),claim_token=NULL,lease_until=NULL WHERE sent_at IS NULL AND quarantined_at IS NULL AND attempts >= $1 AND (lease_until IS NULL OR lease_until<now())`, [maxAttempts]);
        const row = (await tx.query<GroupMailClaim>(`UPDATE ${t.group_mail_outbox} SET claim_token=$1,lease_until=now()+$2*interval '1 second',attempts=attempts+1,
          next_attempt_at=now()+LEAST(3600,60*power(2,attempts))*interval '1 second'
          WHERE id IN (SELECT id FROM ${t.group_mail_outbox} WHERE sent_at IS NULL AND quarantined_at IS NULL AND attempts<$3 AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id,email,recipient_id,group_id,group_name,handle,action,sender_id,attempts,claim_token`, [token, leaseSeconds, maxAttempts])).rows[0];
        return row ?? null;
      });
    },
    async settleGroupMail({id, claimToken, outcome, recipientId, maxAttempts}) {
      const result = outcome === 'pin'
        ? await db.query(`UPDATE ${t.group_mail_outbox} SET recipient_id=$3 WHERE ${owned} RETURNING id`, [id, claimToken, recipientId ?? null])
        : outcome === 'sent'
          ? await db.query(`UPDATE ${t.group_mail_outbox} SET sent_at=now(),lease_until=NULL,claim_token=NULL WHERE ${owned} RETURNING id`, [id, claimToken])
          : await db.query(`UPDATE ${t.group_mail_outbox} SET lease_until=NULL,claim_token=NULL,quarantined_at=CASE WHEN attempts >= $3 THEN now() ELSE NULL END WHERE ${owned} RETURNING id`, [id, claimToken, maxAttempts]);
      return {owned: result.rows.length > 0};
    },
  };
}
