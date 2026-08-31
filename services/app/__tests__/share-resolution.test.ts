/**
 * EMAIL IS AN ATTRIBUTE, NEVER AN IDENTITY KEY. A share is keyed by email so
 * an invite can predate the account — but the moment a signed-in person
 * matches it, the share is RESOLVED to their user id and follows the account
 * through any email change. An unresolved invite to the old address stops
 * matching, which is the correct behaviour (Notion and Figma do the same).
 */
import { describe, expect, it } from 'vitest';
import { canReadArtifact, createArtifact, effectiveRole as roleFor, updateSharingFor } from '@/lib/artifacts';

import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, setUserEmail } from '@/lib/users';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

async function privateDoc() {
  const owner = await createUser({ email: 'mxmx_test_owner@example.com' });
  const t = await mintToken('o'); await claimToken(owner.id, t.token);
  const row = await createArtifact(t.id, owner.id, { format: 'markup', content: '', source: '<div><p>x</p></div>', meta: {}, visibility: 'private', title: 't' });
  return { owner, t, row };
}

describe('share resolution', () => {
  it('an invite by email is resolved to the user on first match, and survives an email change', async () => {
    const { owner, row } = await privateDoc();
    await updateSharingFor({ tokenId: '', userId: owner.id }, row.id, { shares: [{ email: 'guest@example.com', role: 'editor' }] });
    const guest = await createUser({ email: 'guest@example.com' });
    expect(await canReadArtifact(row, { userId: guest.id, email: guest.email })).toBe(true);
    const db = await harness.db();
    const stamped = await db.query<{ user_id: string | null }>('SELECT user_id FROM artifact_shares WHERE artifact_id = $1', [row.id]);
    expect(stamped.rows[0].user_id, 'resolved on first match').toBe(guest.id);

    await setUserEmail(guest.id, 'guest-new@example.com');
    expect(await canReadArtifact(row, { userId: guest.id, email: 'guest-new@example.com' })).toBe(true);
    expect(await roleFor(row, { userId: guest.id, tokenId: null }), 'the role follows the account').toBe('editor');
  });

  it('an UNRESOLVED invite to an address the user no longer has does not grant', async () => {
    const { owner, row } = await privateDoc();
    const guest = await createUser({ email: 'guest@example.com' });
    await setUserEmail(guest.id, 'guest-new@example.com');
    await updateSharingFor({ tokenId: '', userId: owner.id }, row.id, { shares: [{ email: 'guest@example.com', role: 'viewer' }] });
    expect(await canReadArtifact(row, { userId: guest.id, email: 'guest-new@example.com' })).toBe(false);
    expect(await roleFor(row, { userId: guest.id, tokenId: null })).toBe('none');
  });
});
