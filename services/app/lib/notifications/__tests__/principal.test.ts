/**
 * lib/notifications' execution authority and record-side hooks, through its index: the principal a job runs as is
 * re-read from rows (a live account or token, never a guest, a revoked or expired token, or a token for another
 * audience), the authority locks, erasure, the event projection's social notifications and the optional delivery.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MutationNotificationJobInput } from '@artifactbin/contracts';
import { createGuestOwner, mintAccountToken, useAppHarness } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';
import {
  NotificationExecutionError, eraseMutationNotifications, lockMutationNotificationAuthority, lockNotificationExecution, notificationDelivery,
  notificationPrincipal, projectNotifications, setNotificationDelivery,
} from '@/lib/notifications';
import { envelope, getDb } from '@/lib/platform';

useAppHarness();
afterEach(() => setNotificationDelivery(undefined));

const refused = async (work: Promise<unknown>) => {
  const error = await work.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(NotificationExecutionError);
  return (error as NotificationExecutionError).code;
};

describe('the job principal', () => {
  it('is a live account, or a live token and its account, rebuilt without any editor grant', async () => {
    const db = await getDb();
    const t = await mintAccountToken('cli');
    const byUser = await notificationPrincipal(db, { kind: 'user', id: t.userId! });
    expect(byUser).toMatchObject({ kind: 'account', actor: { userId: t.userId, tokenId: null, documentEditor: false } });
    expect(byUser.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(await notificationPrincipal(db, { kind: 'token', id: t.id })).toMatchObject({ actor: { userId: t.userId, tokenId: t.id } });
  });

  it('is refused for a guest, an unknown account, a revoked, expired or foreign-audience token, and any other kind', async () => {
    const db = await getDb();
    const guest = await createGuestOwner();
    const revoked = await mintAccountToken('revoked'), expired = await mintAccountToken('expired'), foreign = await mintAccountToken('foreign');
    await db.query('UPDATE tokens SET deleted_at = now() WHERE id = $1', [revoked.id]);
    await db.query("UPDATE tokens SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id]);
    await db.query("UPDATE tokens SET audience = 'https://elsewhere.example/api', scope = 'artifacts' WHERE id = $1", [foreign.id]);
    for (const principal of [
      { kind: 'user', id: guest.userId }, { kind: 'user', id: 'usr_missing' }, { kind: 'token', id: revoked.id },
      { kind: 'token', id: expired.id }, { kind: 'token', id: foreign.id }, { kind: 'system', id: 'x' },
    ]) expect(await refused(notificationPrincipal(db, principal as never)), JSON.stringify(principal)).toBe('notification_access_revoked');
  });

  it('fences an execution only for a live principal reading its document', async () => {
    const user = await createUser({ email: 'runner@example.test' });
    const input = {
      origin: { mutationRunId: 'run', documentId: 'doc_missing', documentEditId: 'e', documentVersion: 1, mutationName: 'change' },
      initiator: { principal: { kind: 'user', id: user.id }, execution: 'human', agentLabel: null },
      rules: [], bindings: { values: {}, types: {}, userId: user.id, now: '2026-01-01T00:00:00Z', tz: 'UTC' }, contextSnapshot: {}, contextRevision: '',
    } as unknown as MutationNotificationJobInput;
    const db = await getDb();
    expect(await refused(db.transaction(tx => lockNotificationExecution(tx, input)))).toBe('notification_access_revoked');
    expect(await refused(db.transaction(tx => lockNotificationExecution(tx, { ...input, initiator: { ...input.initiator, principal: { kind: 'token', id: 'tok_missing' } } })))).toBe('notification_access_revoked');
  });
});

describe('record-side hooks', () => {
  it('locks the authority tables for reading or writing inside a transaction', async () => {
    const db = await getDb();
    await expect(db.transaction(tx => lockMutationNotificationAuthority(tx))).resolves.toBeUndefined();
    await expect(db.transaction(tx => lockMutationNotificationAuthority(tx, 'write'))).resolves.toBeUndefined();
  });

  it('erases nothing for an account with no jobs or notifications', async () => {
    const db = await getDb();
    await db.query("INSERT INTO event_outbox(id, envelope) VALUES ('keep', '{\"verb\":\"notification_changed\",\"payload\":{\"notification_id\":\"other\"}}'::jsonb)");
    await db.transaction(tx => eraseMutationNotifications(tx, 'usr_none', ['doc_none']));
    expect((await db.query('SELECT id FROM event_outbox')).rows).toEqual([{ id: 'keep' }]);
  });

  it('projects a like and a follow into one notification for the other person, never for oneself or nobody', async () => {
    const db = await getDb();
    const owner = await createUser({ email: 'owner@example.test' }), fan = await createUser({ email: 'fan@example.test' });
    await db.query('INSERT INTO artifacts (id, user_id, token_id) VALUES ($1, $2, $3)', ['art_liked', owner.id, 'tok_x']);
    const fact = (subject: string | null, verb: string, kind: 'artifact' | 'user', id: string) =>
      envelope(subject ? { kind: 'user', id: subject } as never : null, verb as never, { kind, id } as never, {} as never);
    await db.transaction(async tx => {
      await projectNotifications(tx, fact(fan.id, 'liked', 'artifact', 'art_liked'));
      await projectNotifications(tx, fact(fan.id, 'liked', 'artifact', 'art_liked'));
      await projectNotifications(tx, fact(fan.id, 'followed', 'user', owner.id));
      await projectNotifications(tx, fact(owner.id, 'liked', 'artifact', 'art_liked'));
      await projectNotifications(tx, fact(null, 'liked', 'artifact', 'art_liked'));
    });
    const rows = (await db.query<{ id: string; recipient_id: string; kind: string }>('SELECT id, recipient_id, kind FROM member_notifications ORDER BY id')).rows;
    expect(rows).toEqual([
      { id: `social:follow:${fan.id}:${owner.id}`, recipient_id: owner.id, kind: 'follow' },
      { id: `social:like:${fan.id}:art_liked`, recipient_id: owner.id, kind: 'like' },
    ]);
  });

  it('has no email delivery until a deployment installs one', () => {
    expect(notificationDelivery()).toBeUndefined();
    const delivery = { preferences: async () => ({ invitations: true, comments: true, activity: false }), updatePreferences: async (_: string, p: never) => p, click: async () => null };
    setNotificationDelivery(delivery);
    expect(notificationDelivery()).toBe(delivery);
  });
});
