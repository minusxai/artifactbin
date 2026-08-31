/**
 * GENERAL ACCESS — the link carries a ROLE, not merely read-or-not.
 *
 * Two lists decide everything: the people named on the artifact, and whoever
 * holds the address. `visibility` keeps answering REACH and LISTING; the new
 * `link_role` answers what the link's holder may DO. They compose by `max`
 * with ownership, so a share can only ever raise what the link already grants.
 *
 * One rule bounds the whole thing: ANONYMOUS CAPS AT VIEWER. Every write in
 * this product is attributed, so anything above a read needs an account — and
 * that single rule replaces the two carve-outs (may a stranger comment, may a
 * link grant edit) that would otherwise each need their own answer.
 *
 * Back-compat is the other half of the file: `link_role` is NULL on every row
 * written before the column, and NULL means `viewer` — precisely what those
 * rows already granted, so nothing was backfilled and nothing moved.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from './harness';
import {
  applyEditFor, createArtifact, effectiveRole, getSharingFor, linkRoleOf, updateSharingFor,
  type ArtifactRow, type Visibility,
} from '@/lib/artifacts';
import { createAnnotationFor, listAnnotationsFor } from '@/lib/annotations';
import { ANONYMOUS_CEILING, capRole, type ShareRole } from '@/lib/share-roles';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const SOURCE = '<div><p>hello</p></div>';

const harness = useAppHarness();

async function account(email: string) {
  const user = await createUser({ email });
  const token = await mintToken(email);
  await claimToken(user.id, token.token);
  return { user, token };
}

async function docOf(
  owner: { user: { id: string }; token: { id: string } },
  visibility: Visibility,
  linkRole?: ShareRole,
): Promise<ArtifactRow> {
  const row = await createArtifact(owner.token.id, owner.user.id, {
    format: 'markup', content: '', source: SOURCE, meta: {}, visibility, title: 't',
  });
  if (!linkRole) return row;
  await updateSharingFor({ tokenId: '', userId: owner.user.id }, row.id, { linkRole });
  return (await head(row.id))!;
}

async function head(id: string): Promise<ArtifactRow | null> {
  const db = await harness.db();
  const r = await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

/** A row exactly as it was written before the column existed. */
async function clearLinkRole(id: string): Promise<ArtifactRow> {
  const db = await harness.db();
  await db.query('UPDATE artifacts SET link_role = NULL WHERE id = $1', [id]);
  return (await head(id))!;
}

describe('capRole and the anonymous ceiling', () => {
  it('holds a role down to the ceiling and leaves anything under it alone', () => {
    expect(capRole('editor', 'viewer')).toBe('viewer');
    expect(capRole('commenter', 'viewer')).toBe('viewer');
    expect(capRole('viewer', 'viewer')).toBe('viewer');
    expect(capRole('none', 'viewer'), 'a cap never PROMOTES').toBe('none');
    expect(ANONYMOUS_CEILING).toBe('viewer');
  });
});

describe('linkRoleOf — the column, with visibility as the gate above it', () => {
  it('reads the stored role on a link-readable document', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    for (const role of ['viewer', 'commenter', 'editor'] as ShareRole[]) {
      expect(linkRoleOf(await docOf(owner, 'public', role))).toBe(role);
      expect(linkRoleOf(await docOf(owner, 'unlisted', role))).toBe(role);
    }
  });

  it('is none while private, whatever the column says — reach gates role', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    expect(linkRoleOf(await docOf(owner, 'private', 'editor'))).toBe('none');
  });

  it('treats a row written before the column as viewer — nothing to backfill', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const legacy = await clearLinkRole((await docOf(owner, 'public')).id);
    expect(legacy.link_role, 'the pre-column shape').toBeNull();
    expect(linkRoleOf(legacy)).toBe('viewer');
    expect(linkRoleOf(await clearLinkRole((await docOf(owner, 'private')).id))).toBe('none');
  });
});

describe('effectiveRole — the link grants a role to whoever holds the address', () => {
  it('gives a signed-in stranger exactly what the link says', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = { userId: stranger.user.id, tokenId: null, email: stranger.user.email };

    for (const role of ['viewer', 'commenter', 'editor'] as ShareRole[]) {
      expect([role, await effectiveRole(await docOf(owner, 'public', role), asStranger)]).toEqual([role, role]);
    }
  });

  it('CAPS anonymous at viewer — a write needs an account, whatever the link grants', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const anonToken = await mintToken('anon-browser');

    for (const role of ['commenter', 'editor'] as ShareRole[]) {
      const row = await docOf(owner, 'public', role);
      expect([role, await effectiveRole(row, { userId: null, tokenId: null })], 'nobody at all').toEqual([role, 'viewer']);
      // An anonymous TOKEN is not an account: attributable to a token, but with
      // no handle to show beside a comment. It sits under the ceiling too.
      expect([role, await effectiveRole(row, { userId: null, tokenId: anonToken.id })]).toEqual([role, 'viewer']);
    }
  });

  it('still answers none to everyone on a private document, whatever the link column holds', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const row = await docOf(owner, 'private', 'editor');
    expect(await effectiveRole(row, { userId: stranger.user.id, tokenId: null, email: stranger.user.email })).toBe('none');
  });

  it('takes the MAX of the link and a named share, in both directions', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const guest = await account('mxmx_test_guest@example.com');
    const asGuest = { userId: guest.user.id, tokenId: null, email: guest.user.email };

    // The share is higher than the link.
    const linkViews = await docOf(owner, 'public', 'viewer');
    await updateSharingFor({ tokenId: '', userId: owner.user.id }, linkViews.id, { shares: [{ email: guest.user.email!, role: 'editor' }] });
    expect(await effectiveRole(await head(linkViews.id) as ArtifactRow, asGuest)).toBe('editor');

    // The link is higher than the share — and a lesser share must not demote.
    const linkEdits = await docOf(owner, 'public', 'editor');
    await updateSharingFor({ tokenId: '', userId: owner.user.id }, linkEdits.id, { shares: [{ email: guest.user.email!, role: 'viewer' }] });
    expect(await effectiveRole(await head(linkEdits.id) as ArtifactRow, asGuest), 'a viewer share cannot pull a link editor down').toBe('editor');
  });

  it('leaves the owner untouched at every setting', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'public', 'viewer');
    expect(await effectiveRole(row, { userId: owner.user.id, tokenId: null })).toBe('owner');
  });
});

describe('the sharing surface round-trips the link role', () => {
  it('persists it, reads it back, and reports viewer for a pre-column row', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const actor = { tokenId: '', userId: owner.user.id };
    const row = await docOf(owner, 'public');

    expect((await getSharingFor(actor, row.id))?.linkRole, 'the default').toBe('viewer');
    await updateSharingFor(actor, row.id, { linkRole: 'commenter' });
    expect((await getSharingFor(actor, row.id))?.linkRole).toBe('commenter');

    // Set while private, it is REMEMBERED rather than reset — flipping the tier
    // back must restore the choice the owner already made.
    await updateSharingFor(actor, row.id, { visibility: 'private' });
    expect((await getSharingFor(actor, row.id))?.linkRole).toBe('commenter');
    expect(linkRoleOf(await head(row.id) as ArtifactRow), '…while granting nothing meanwhile').toBe('none');
  });
});

describe('the SQL scopes admit the link — the doors, not just the predicate', () => {
  it('lets a signed-in stranger COMMENT on a link-commentable document', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const row = await docOf(owner, 'public', 'commenter');

    const made = await createAnnotationFor(
      { tokenId: stranger.token.id, userId: stranger.user.id },
      row.id,
      { bodyPath: '0', baseEditId: row.edit_id, body: 'a stranger with the link says something' },
      { kind: 'human', label: 'stranger', transport: 'browser' },
    );
    expect(made, JSON.stringify(made)).toMatchObject({ status: 'open' });

    // …and the owner sees it.
    const seen = await listAnnotationsFor({ tokenId: owner.token.id, userId: owner.user.id }, row.id);
    expect(seen?.length).toBe(1);
  });

  it('refuses that same stranger a comment when the link only grants a view', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const row = await docOf(owner, 'public', 'viewer');
    const made = await createAnnotationFor(
      { tokenId: stranger.token.id, userId: stranger.user.id },
      row.id,
      { bodyPath: '0', baseEditId: row.edit_id, body: 'nope' },
      { kind: 'human', label: 'stranger', transport: 'browser' },
    );
    expect(made, 'the uniform miss').toBeNull();
  });

  it('lets a signed-in stranger EDIT a link-editable document, and refuses a link-commentable one', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = { tokenId: stranger.token.id, userId: stranger.user.id };

    const editable = await docOf(owner, 'public', 'editor');
    const ok = await applyEditFor(asStranger, editable.id, {
      baseEditId: editable.edit_id, change: { oldString: 'hello', newString: 'edited' },
    });
    expect(ok, JSON.stringify(ok)).toMatchObject({ applied: true });
    expect((await head(editable.id))?.source).toContain('edited');

    const commentable = await docOf(owner, 'public', 'commenter');
    const refused = await applyEditFor(asStranger, commentable.id, {
      baseEditId: commentable.edit_id, change: { oldString: 'hello', newString: 'nope' },
    });
    expect(refused, 'a commenter link is not an edit link').toBeNull();
  });

  it('never lets the link reach GOVERNANCE — sharing stays the owner\'s', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const row = await docOf(owner, 'public', 'editor');
    expect(await getSharingFor({ tokenId: stranger.token.id, userId: stranger.user.id }, row.id)).toBeNull();
    expect(await updateSharingFor({ tokenId: stranger.token.id, userId: stranger.user.id }, row.id, { visibility: 'private' })).toBeNull();
  });
});
