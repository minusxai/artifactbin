/**
 * `users.welcome_pending`: TRUE only for a person the app first met through
 * their claims (lib/profiles) — the row it creates for them starts with the
 * welcome page pending. A row that already existed keeps its flag on every
 * later sync, and a row made any other way (createUser: fixtures, test
 * people) starts with nothing pending.
 */
import { describe, expect, it } from 'vitest';
import { syncProfile } from '@/lib/profiles';
import { createUser, getUserById } from '@/lib/users';
import { getDb } from '@/lib/db';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

describe('welcome_pending', () => {
  it('is set when the app first creates a row from claims, and kept on later syncs', async () => {
    const id = 'usr_welcome_' + Math.random().toString(36).slice(2, 8);
    await syncProfile({ userId: id, email: `mxmx_test_${id}@example.com` });
    expect((await getUserById(id))?.welcome_pending).toBe(true);

    await (await getDb()).query('UPDATE users SET welcome_pending = false WHERE id = $1', [id]);
    await syncProfile({ userId: id, email: `mxmx_test_${id}_renamed@example.com` });
    const after = await getUserById(id);
    expect(after?.email).toBe(`mxmx_test_${id}_renamed@example.com`);
    expect(after?.welcome_pending).toBe(false);
  });

  it('is false for a row created directly, and the row carries no picture', async () => {
    const user = await createUser({ email: 'mxmx_test_direct@example.com' });
    expect(user.welcome_pending).toBe(false);
    expect(user.image_key).toBeNull();
  });
});
