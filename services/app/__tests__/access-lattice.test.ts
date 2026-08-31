/**
 * THE ACCESS LATTICE — one ordered vocabulary, one decision.
 *
 * `effectiveRole` replaces the `canReadArtifact` + `roleFor` pair, which asked
 * the same question twice and answered it by different rules: one matched
 * EVERY share role and the session's own address, the other matched only
 * editor/commenter and only through `users.email`. The union of the two is
 * what this file pins — and because every disagreement between them was
 * between values of EQUAL rank (`reader` vs a named `viewer`), the swap is
 * behaviour-preserving. The last describe block is that guarantee, stated as
 * tests rather than as a claim.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from './harness';
import {
  canReadArtifact, createArtifact, effectiveRole, linkRoleOf, updateSharingFor,
  type ArtifactRow,
} from '@/lib/artifacts';
import {
  ROLE_ORDER, atLeast, canAnnotate, canEdit, canGovern, canRead, maxRole, rankOf, shareRolesAtLeast,
  type ArtifactRole, type ShareRole,
} from '@/lib/share-roles';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, setUserEmail } from '@/lib/users';
import type { Visibility } from '@/lib/artifacts';

useAppHarness();

/** An account plus one of its claimed tokens — the ordinary signed-in owner. */
async function account(email: string) {
  const user = await createUser({ email });
  const token = await mintToken(email);
  await claimToken(user.id, token.token);
  return { user, token };
}

async function docOf(owner: { user: { id: string }; token: { id: string } }, visibility: Visibility): Promise<ArtifactRow> {
  return createArtifact(owner.token.id, owner.user.id, {
    format: 'markup', content: '', source: '<div><p>x</p></div>', meta: {}, visibility, title: 't',
  });
}

const shareWith = (owner: { user: { id: string } }, row: ArtifactRow, email: string, role: ShareRole) =>
  updateSharingFor({ tokenId: '', userId: owner.user.id }, row.id, { shares: [{ email, role }] });

/** Nobody at all — the anonymous visitor holding only the address. */
const STRANGER = { userId: null, tokenId: null };

describe('the lattice is an ordering, and every question is a comparison on it', () => {
  it('orders none < viewer < commenter < editor < owner', () => {
    expect(ROLE_ORDER).toEqual(['none', 'viewer', 'commenter', 'editor', 'owner']);
    const ranks = ROLE_ORDER.map(rankOf);
    expect(ranks, 'strictly ascending').toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size, 'no two roles share a rank').toBe(ranks.length);
  });

  it('ranks an unknown value as none — an unrecognised role must fail closed', () => {
    expect(rankOf('nonsense' as ArtifactRole)).toBe(rankOf('none'));
    expect(canRead('nonsense' as ArtifactRole)).toBe(false);
  });

  it('maxRole takes the highest, and nothing offered is none', () => {
    expect(maxRole()).toBe('none');
    expect(maxRole('none', 'viewer')).toBe('viewer');
    expect(maxRole('viewer', 'editor', 'commenter')).toBe('editor');
    expect(maxRole('owner', 'viewer')).toBe('owner');
    // The load-bearing direction: a lesser grant can never pull a greater one down.
    expect(maxRole('editor', 'viewer'), 'a viewer share cannot demote an editor').toBe('editor');
  });

  it('atLeast compares in the right direction', () => {
    expect(atLeast('editor', 'commenter')).toBe(true);
    expect(atLeast('commenter', 'editor')).toBe(false);
    expect(atLeast('viewer', 'viewer')).toBe(true);
    expect(atLeast('none', 'viewer')).toBe(false);
  });

  it('answers the four capability questions from the one ordering', () => {
    const table: Array<[ArtifactRole, boolean, boolean, boolean, boolean]> = [
      // role          read   annotate  edit   govern
      ['none', false, false, false, false],
      ['viewer', true, false, false, false],
      ['commenter', true, true, false, false],
      ['editor', true, true, true, false],
      ['owner', true, true, true, true],
    ];
    for (const [role, read, annotate, edit, govern] of table) {
      expect([role, canRead(role)]).toEqual([role, read]);
      expect([role, canAnnotate(role)]).toEqual([role, annotate]);
      expect([role, canEdit(role)]).toEqual([role, edit]);
      expect([role, canGovern(role)]).toEqual([role, govern]);
    }
  });

  it('derives the share-role list a scoped SQL predicate names', () => {
    expect(shareRolesAtLeast('editor')).toEqual(['editor']);
    expect(shareRolesAtLeast('commenter')).toEqual(['commenter', 'editor']);
    expect(shareRolesAtLeast('viewer')).toEqual(['viewer', 'commenter', 'editor']);
  });
});

describe('linkRoleOf — what the address alone grants', () => {
  it('private grants nothing; unlisted and public grant a view', () => {
    expect(linkRoleOf({ visibility: 'private', link_role: null })).toBe('none');
    expect(linkRoleOf({ visibility: 'unlisted', link_role: null })).toBe('viewer');
    expect(linkRoleOf({ visibility: 'public', link_role: null })).toBe('viewer');
  });
});

describe('effectiveRole — ownership, the share list and the link, composed by max', () => {
  it('the owning account is owner under every visibility', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    for (const v of ['private', 'unlisted', 'public'] as Visibility[]) {
      const row = await docOf(owner, v);
      expect(await effectiveRole(row, { userId: owner.user.id, tokenId: null })).toBe('owner');
    }
  });

  it('a bare token owns what it created — an anonymous owner is still an owner', async () => {
    const token = await mintToken('anon');
    const row = await createArtifact(token.id, null, { format: 'markup', content: '', source: '<div><p>x</p></div>', meta: {}, visibility: 'unlisted', title: 't' });
    expect(await effectiveRole(row, { userId: null, tokenId: token.id })).toBe('owner');
    expect(await effectiveRole(row, { userId: null, tokenId: 'tok_someone_else' })).toBe('viewer');
  });

  it('a named share grants exactly its role on a private document', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    for (const role of ['viewer', 'commenter', 'editor'] as ShareRole[]) {
      const row = await docOf(owner, 'private');
      const guest = await account(`mxmx_test_${role}@example.com`);
      await shareWith(owner, row, guest.user.email!, role);
      expect(await effectiveRole(row, { userId: guest.user.id, tokenId: null })).toBe(role);
    }
  });

  it('a stranger gets none on a private document and viewer on a link-readable one', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = { userId: stranger.user.id, tokenId: null, email: stranger.user.email };

    expect(await effectiveRole(await docOf(owner, 'private'), asStranger)).toBe('none');
    expect(await effectiveRole(await docOf(owner, 'private'), STRANGER)).toBe('none');
    expect(await effectiveRole(await docOf(owner, 'unlisted'), asStranger)).toBe('viewer');
    expect(await effectiveRole(await docOf(owner, 'unlisted'), STRANGER)).toBe('viewer');
    expect(await effectiveRole(await docOf(owner, 'public'), STRANGER)).toBe('viewer');
  });

  it('a share RAISES what the link grants and never lowers it', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const guest = await account('mxmx_test_guest@example.com');

    // A public document already grants `viewer` to everyone. An editor share on
    // it must still reach `editor` — this is exactly what lets a public
    // document have editors at all.
    const open = await docOf(owner, 'public');
    await shareWith(owner, open, guest.user.email!, 'editor');
    expect(await effectiveRole(open, { userId: guest.user.id, tokenId: null })).toBe('editor');

    // …and the reverse direction is a no-op, not a demotion: a `viewer` share
    // on a public document leaves them exactly where the link already put them.
    const alsoOpen = await docOf(owner, 'public');
    await shareWith(owner, alsoOpen, guest.user.email!, 'viewer');
    expect(await effectiveRole(alsoOpen, { userId: guest.user.id, tokenId: null })).toBe('viewer');
  });

  it('matches an UNRESOLVED invite by the session address, then by the account it stamped', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'private');
    await shareWith(owner, row, 'mxmx_test_late@example.com', 'commenter');

    // The invite predates the account entirely.
    const guest = await createUser({ email: 'mxmx_test_late@example.com' });
    expect(await effectiveRole(row, { userId: guest.id, tokenId: null, email: guest.email })).toBe('commenter');

    // Resolution stamps it, so it now follows the ACCOUNT through an address change.
    await setUserEmail(guest.id, 'mxmx_test_late_new@example.com');
    expect(await effectiveRole(row, { userId: guest.id, tokenId: null, email: 'mxmx_test_late_new@example.com' })).toBe('commenter');
  });

  it("an agent of an invited person reaches what its person does — no session address needed", async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'private');
    const guest = await account('mxmx_test_agent_person@example.com');
    await shareWith(owner, row, guest.user.email!, 'editor');
    // A bearer token resolves to its user with NO email attached (viewer.email
    // is null): the match has to go through users.email.
    expect(await effectiveRole(row, { userId: guest.user.id, tokenId: guest.token.id, email: null })).toBe('editor');
  });

  it('an UNRESOLVED invite to an address the person no longer has grants nothing', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'private');
    const guest = await createUser({ email: 'mxmx_test_old@example.com' });
    await setUserEmail(guest.id, 'mxmx_test_new@example.com');
    await shareWith(owner, row, 'mxmx_test_old@example.com', 'editor');
    expect(await effectiveRole(row, { userId: guest.id, tokenId: null, email: 'mxmx_test_new@example.com' })).toBe('none');
  });
});

describe('canReadArtifact is now canRead(effectiveRole) — and answers exactly what it did before', () => {
  it('preserves every verdict the old pair gave', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const guest = await account('mxmx_test_guest@example.com');
    const asGuest = { userId: guest.user.id, email: guest.user.email };

    const priv = await docOf(owner, 'private');
    expect(await canReadArtifact(priv, { userId: owner.user.id, email: owner.user.email })).toBe(true);
    expect(await canReadArtifact(priv, asGuest), 'a stranger cannot read a private document').toBe(false);
    expect(await canReadArtifact(priv, null), 'nor can an anonymous visitor').toBe(false);

    // Every share role reads a private document — including `viewer`, which the
    // old roleFor deliberately ignored while canReadArtifact honoured it.
    for (const role of ['viewer', 'commenter', 'editor'] as ShareRole[]) {
      const row = await docOf(owner, 'private');
      await shareWith(owner, row, guest.user.email!, role);
      expect([role, await canReadArtifact(row, asGuest)]).toEqual([role, true]);
    }

    for (const v of ['unlisted', 'public'] as Visibility[]) {
      const row = await docOf(owner, v);
      expect([v, await canReadArtifact(row, null)]).toEqual([v, true]);
    }
  });
});
