/**
 * lib/notifications' record-side hooks, through its index: the event projection's social notifications and
 * the optional delivery.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';
import { notificationDelivery, projectNotifications, setNotificationDelivery } from '@/lib/notifications';
import { envelope, getDb } from '@/lib/platform';

useAppHarness();
afterEach(() => setNotificationDelivery(undefined));

describe('record-side hooks', () => {
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
