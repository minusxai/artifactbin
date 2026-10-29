import { beforeEach, describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { getDb } from '@/lib/platform';
import { ACCOUNT_REACH_SQL, authenticatingTestParent, canAuthenticateUser, isLinkOnlyKind, userKindOf } from '..';

useAppHarness();
type Row = { id: string; kind: string; email?: string | null; parent?: string | null; expires?: string | null };
async function users(...rows: Row[]) {
  const db = await getDb();
  for (const row of rows) await db.query('INSERT INTO users (id, kind, email, parent_user_id, expires_at) VALUES ($1,$2,$3,$4,$5)', [row.id, row.kind, row.email ?? null, row.parent ?? null, row.expires ?? null]);
}
beforeEach(async () => {
  await users(
    { id: 'acct', kind: 'account', email: 'mxmx_test_acct@example.com' },
    { id: 'acct_no_email', kind: 'account' },
    { id: 'guest', kind: 'guest' },
    { id: 'tu_live', kind: 'testuser', parent: 'acct' },
    { id: 'tu_future', kind: 'testuser', parent: 'acct', expires: new Date(Date.now() + 3_600_000).toISOString() },
    { id: 'tu_expired', kind: 'testuser', parent: 'acct', expires: new Date(Date.now() - 1000).toISOString() },
    { id: 'tu_orphan', kind: 'testuser', parent: 'missing' },
    { id: 'tu_guest_parent', kind: 'testuser', parent: 'guest' },
    { id: 'tu_emailless_parent', kind: 'testuser', parent: 'acct_no_email' },
  );
});

describe('userKindOf', () => {
  it('reads the kind column, and null for no id or no row', async () => {
    expect(await userKindOf('acct')).toBe('account');
    expect(await userKindOf('guest')).toBe('guest');
    expect(await userKindOf('tu_live')).toBe('testuser');
    expect(await userKindOf('nobody')).toBeNull();
    expect(await userKindOf(null)).toBeNull();
    expect(await userKindOf(undefined)).toBeNull();
    expect(await userKindOf('')).toBeNull();
  });

  it('reads through a caller transaction, seeing its uncommitted rows', async () => {
    const db = await getDb();
    await db.transaction(async tx => {
      await tx.query("INSERT INTO users (id, kind) VALUES ('inside', 'guest')");
      expect(await userKindOf('inside', tx)).toBe('guest');
    });
  });
});

describe('canAuthenticateUser and authenticatingTestParent', () => {
  it('authenticates an email account and a live test user delegated by one', async () => {
    expect(await canAuthenticateUser('acct')).toBe(true);
    expect(await canAuthenticateUser('tu_live')).toBe(true);
    expect(await canAuthenticateUser('tu_future')).toBe(true);
    expect(await authenticatingTestParent('tu_live')).toBe('acct');
    expect(await authenticatingTestParent('tu_future')).toBe('acct');
  });

  it('refuses guests, email-less accounts, expired or orphaned test users and parents that are not email accounts', async () => {
    for (const id of ['guest', 'acct_no_email', 'tu_expired', 'tu_orphan', 'tu_guest_parent', 'tu_emailless_parent', 'nobody', null, undefined, ''])
      expect(await canAuthenticateUser(id)).toBe(false);
    for (const id of ['acct', 'guest', 'tu_expired', 'tu_orphan', 'tu_guest_parent', 'tu_emailless_parent', 'nobody'])
      expect(await authenticatingTestParent(id)).toBeNull();
  });

  it('follows the parent state at read time: a parent losing its email ends the delegation', async () => {
    const db = await getDb();
    await db.query("UPDATE users SET email = NULL WHERE id = 'acct'");
    expect(await canAuthenticateUser('tu_live', db)).toBe(false);
    expect(await authenticatingTestParent('tu_live', db)).toBeNull();
  });
});

describe('isLinkOnlyKind', () => {
  it('is true for guests and test users only', () => {
    expect(isLinkOnlyKind('guest')).toBe(true);
    expect(isLinkOnlyKind('testuser')).toBe(true);
    expect(isLinkOnlyKind('account')).toBe(false);
    expect(isLinkOnlyKind(null)).toBe(false);
  });
});

describe('ACCOUNT_REACH_SQL', () => {
  const reaches = async (actor: string, owner: string) => (await (await getDb()).query(
    `SELECT 1 FROM (VALUES ($2::text)) AS artifacts(user_id) WHERE ${ACCOUNT_REACH_SQL('$1')}`, [actor, owner])).rows.length === 1;

  it('gives an account full reach and a guest none', async () => {
    expect(await reaches('acct', 'guest')).toBe(true);
    expect(await reaches('guest', 'acct')).toBe(false);
    expect(await reaches('guest', 'tu_live')).toBe(false);
  });

  it('gives a test user full reach only inside the sandbox (rows another test user owns)', async () => {
    expect(await reaches('tu_live', 'tu_future')).toBe(true);
    expect(await reaches('tu_live', 'acct')).toBe(false);
  });

  it('keeps a user id without a row at full reach (the legacy polarity) and interpolates only the parameter name', async () => {
    expect(await reaches('nobody', 'acct')).toBe(true);
    expect(ACCOUNT_REACH_SQL('$7')).toContain('actor_user.id = $7');
    expect(ACCOUNT_REACH_SQL('$7')).not.toContain('$1');
  });
});
