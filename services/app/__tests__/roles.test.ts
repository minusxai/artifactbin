import { describe, expect, it, beforeEach } from 'vitest';
import { useAppHarness, mintAccountToken as mintToken, setSession, request } from '@/__tests__/harness';
import { applyEditFor, artifactQuery, type ArtifactRow, canReadArtifact, changeMembership, createArtifact, effectiveRole, effectiveRole as roleFor, getArtifactById, getSharingFor, getVersionFor, invitePeople, membershipInbox, membershipState, mentionCandidates, parseShareEntries, roleFor as requestRoleFor, updateMembershipInbox, updateSharingFor } from '@/lib/artifacts';
import { committedHeadsSettled } from '@/lib/artifacts/store';
import { linkRoleOf } from '@/lib/artifacts/access';
import { ANONYMOUS_CEILING, type ArtifactRole, atLeast, canAnnotate, canEdit, canGovern, canRead, capRole, maxRole, rankOf, ROLE_ORDER, SHARE_ROLE_LABEL, SHARE_ROLES, type ShareRole, shareRolesAtLeast, type Visibility } from '@artifactbin/contracts';
import { claimToken, createUser, setUserEmail, ensureUsername, setRelationState, has, count, linked, link } from '@/lib/accounts';
import { documentEdit, documentEditBody, documentPublicationBody } from '@/__tests__/prepared-document';
import { createAnnotationFor, listAnnotationsFor, actOnAnnotationFor } from '@/lib/annotations';
import { PUT as putArtifactRoute, GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as editsRoute } from '@/app/api/artifacts/[id]/edits/route';
import { POST as createArtifactRoute, POST as create, GET as listArtifactsRoute } from '@/app/api/artifacts/route';
import { GET as getSharingRoute, PUT as putSharingRoute, GET as read, PUT as write } from '@/app/api/my/artifacts/[id]/sharing/route';
import { observedRequest } from '@/__tests__/conditional-request';
import { DELETE as remove, PATCH as metadata, DELETE as deleteMineRoute, GET as getMineRoute, PUT as putMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { POST as restore } from '@/app/api/my/artifacts/[id]/restore/route';
import { advanceGraph } from '@/lib/document/document-graph-patch';
import { graphSource } from '@/lib/document/document-graph';
import { attachActor } from '@artifactbin/utils';
import { POST as annotateBearerRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { POST as editsMineRoute, POST as patchMineRoute, POST as revertMineRoute } from '@/app/api/my/artifacts/[id]/edits/route';
import { GET as versionsMineRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { POST as createAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { DELETE as deleteAnnotationRoute, POST as actOnAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as versionMineRoute } from '@/app/api/my/artifacts/[id]/versions/[version]/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { getDb } from '@/lib/platform';
import { storedCompiledDataflow } from '@/lib/document/parsed-artifact-metadata';
import { hasExplicitNotificationMembership } from '@/lib/notifications';
import { POST } from '@/app/api/my/artifacts/[id]/members/route';

/**
 * ROLES — who may read, comment, edit, govern and join an artifact, in one file over one database.
 *
 * Merged from access-lattice, general-access, collab-commenters, editor-sharing, collab-editors and membership
 * (one harness boot instead of six). The lattice and `effectiveRole` are TABLES: every case those files asserted,
 * each once, as a row naming who asks, of what, and what they get. The doors are tested through the real routes
 * in the describes after them, each keeping the fixtures it was written with.
 *
 *   THE LATTICE — one ordered vocabulary (none < viewer < commenter < editor < owner); every capability is a
 *   comparison on it, an unknown value fails closed, and anonymous caps at viewer.
 *   EFFECTIVE ROLE — ownership, the named shares and the link, composed by max. `visibility` answers REACH and
 *   listing, `link_role` what the link's holder may DO; a row written before the column reads as viewer.
 */
const harness = useAppHarness();

const SOURCE = '<div id="root"><p>hello</p></div>';

/** An account plus one of its claimed tokens — the ordinary signed-in owner. */
async function account(email: string) {
  const user = await createUser({ email });
  const token = await mintToken(email, user.id);
  await claimToken(user.id, token.token);
  return { user, token };
}
type Account = Awaited<ReturnType<typeof account>>;

async function head(id: string): Promise<ArtifactRow | null> {
  const db = await harness.db();
  const r = await artifactQuery<ArtifactRow>(db, 'SELECT * FROM artifacts WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

/** A document of `owner` at `visibility`, its link carrying `linkRole` when one is given. */
async function docOf(owner: Account, visibility: Visibility, linkRole?: ShareRole): Promise<ArtifactRow> {
  const row = await createArtifact(owner.token.id, owner.user.id, { format: 'markup', source: SOURCE, meta: {}, visibility, title: 't' });
  if (!linkRole) return row;
  await updateSharingFor({ tokenId: '', userId: owner.user.id }, row.id, { linkRole });
  return (await head(row.id))!;
}

/** A row exactly as it was written before the column existed. */
async function clearLinkRole(id: string): Promise<ArtifactRow> {
  const db = await harness.db();
  await artifactQuery(db, 'UPDATE artifacts SET link_role = NULL WHERE id = $1', [id]);
  return (await head(id))!;
}

const shareWith = (owner: Account, row: ArtifactRow, email: string, role: ShareRole) =>
  updateSharingFor({ tokenId: '', userId: owner.user.id }, row.id, { shares: [{ email, role }] });

/** Nobody at all — the anonymous visitor holding only the address. */
const STRANGER = { userId: null, tokenId: null };
const SHARE_ROLE_LIST: ShareRole[] = ['viewer', 'commenter', 'editor'];

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

  // [what, actual, expected] — maxRole, atLeast, the share-role list and the anonymous ceiling, one row each.
  const COMPARISONS: Array<[string, () => unknown, unknown]> = [
    ['maxRole of nothing offered', () => maxRole(), 'none'],
    ['maxRole(none, viewer)', () => maxRole('none', 'viewer'), 'viewer'],
    ['maxRole(viewer, editor, commenter)', () => maxRole('viewer', 'editor', 'commenter'), 'editor'],
    ['maxRole(owner, viewer)', () => maxRole('owner', 'viewer'), 'owner'],
    ['a viewer share cannot demote an editor: maxRole(editor, viewer)', () => maxRole('editor', 'viewer'), 'editor'],
    ['atLeast(editor, commenter)', () => atLeast('editor', 'commenter'), true],
    ['atLeast(commenter, editor)', () => atLeast('commenter', 'editor'), false],
    ['atLeast(viewer, viewer)', () => atLeast('viewer', 'viewer'), true],
    ['atLeast(none, viewer)', () => atLeast('none', 'viewer'), false],
    ['shareRolesAtLeast(editor)', () => shareRolesAtLeast('editor'), ['editor']],
    ['shareRolesAtLeast(commenter)', () => shareRolesAtLeast('commenter'), ['commenter', 'editor']],
    ['shareRolesAtLeast(viewer)', () => shareRolesAtLeast('viewer'), ['viewer', 'commenter', 'editor']],
    ['capRole(editor, viewer)', () => capRole('editor', 'viewer'), 'viewer'],
    ['capRole(commenter, viewer)', () => capRole('commenter', 'viewer'), 'viewer'],
    ['capRole(viewer, viewer)', () => capRole('viewer', 'viewer'), 'viewer'],
    ['a cap never PROMOTES: capRole(none, viewer)', () => capRole('none', 'viewer'), 'none'],
    ['the anonymous ceiling', () => ANONYMOUS_CEILING, 'viewer'],
  ];
  it.each(COMPARISONS)('%s', (_what, actual, expected) => {
    expect(actual()).toEqual(expected);
  });

  it.each([
    // role          read   annotate  edit   govern
    ['none', false, false, false, false],
    ['viewer', true, false, false, false],
    ['commenter', true, true, false, false],
    ['editor', true, true, true, false],
    ['owner', true, true, true, true],
  ] as Array<[ArtifactRole, boolean, boolean, boolean, boolean]>)('answers the four capability questions for %s from the one ordering', (role, read, annotate, edit, govern) => {
    expect([canRead(role), canAnnotate(role), canEdit(role), canGovern(role)]).toEqual([read, annotate, edit, govern]);
  });
});

describe('linkRoleOf — what the address alone grants, the column with visibility as the gate above it', () => {
  it('private grants nothing; unlisted and public grant a view when no role is stored', () => {
    expect(linkRoleOf({ visibility: 'private', link_role: null })).toBe('none');
    expect(linkRoleOf({ visibility: 'unlisted', link_role: null })).toBe('viewer');
    expect(linkRoleOf({ visibility: 'public', link_role: null })).toBe('viewer');
  });

  it('reads the stored role on a link-readable document', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    for (const role of SHARE_ROLE_LIST) {
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

/**
 * EFFECTIVE ROLE, as a table: each row builds its world and answers `[asked, expected]` pairs. The rows are the
 * cases access-lattice.test.ts and general-access.test.ts asserted, each once.
 */
type Asked = Parameters<typeof effectiveRole>[1];
const ROLE_CASES: Array<[string, () => Promise<Array<[string, ArtifactRow, Asked, ArtifactRole]>>]> = [
  ['a bare token owns what it created — an anonymous owner is still an owner', async () => {
    const token = await mintToken('anon', null);
    const row = await createArtifact(token.id, token.userId, { format: 'markup', source: SOURCE, meta: {}, visibility: 'unlisted', title: 't' });
    return [['its token', row, { userId: null, tokenId: token.id }, 'owner'], ['another token', row, { userId: null, tokenId: 'tok_someone_else' }, 'viewer']];
  }],
  ['claimed account ownership requires resolved identity, never the creating token alone', async () => {
    const owner = await account('mxmx_test_claimed_owner@example.com');
    const privateRow = await docOf(owner, 'private');
    const publicRow = await docOf(owner, 'public');
    return [
      ['resolved owner token', privateRow, { userId: owner.user.id, tokenId: owner.token.id }, 'owner'],
      ['bare creating token, private', privateRow, { userId: null, tokenId: owner.token.id }, 'none'],
      ['bare creating token, public link', publicRow, { userId: null, tokenId: owner.token.id }, 'viewer'],
      ['other account with creating token', privateRow, { userId: 'usr_other', tokenId: owner.token.id }, 'none'],
    ];
  }],
  ['a named share grants exactly its role on a private document', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const out: Array<[string, ArtifactRow, Asked, ArtifactRole]> = [];
    for (const role of SHARE_ROLE_LIST) {
      const row = await docOf(owner, 'private');
      const guest = await account(`mxmx_test_${role}@example.com`);
      await shareWith(owner, row, guest.user.email!, role);
      out.push([role, row, { userId: guest.user.id, tokenId: null }, role]);
    }
    return out;
  }],
  ['a stranger gets none on a private document and viewer on a link-readable one', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = { userId: stranger.user.id, tokenId: null, email: stranger.user.email };
    return [
      ['signed in, private', await docOf(owner, 'private'), asStranger, 'none'],
      ['nobody, private', await docOf(owner, 'private'), STRANGER, 'none'],
      ['signed in, unlisted', await docOf(owner, 'unlisted'), asStranger, 'viewer'],
      ['nobody, unlisted', await docOf(owner, 'unlisted'), STRANGER, 'viewer'],
      ['nobody, public', await docOf(owner, 'public'), STRANGER, 'viewer'],
    ];
  }],
  ['matches an UNRESOLVED invite by the session address, then by the account it stamped', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'private');
    await shareWith(owner, row, 'mxmx_test_late@example.com', 'commenter');
    // The invite predates the account entirely.
    const guest = await createUser({ email: 'mxmx_test_late@example.com' });
    const before: [string, ArtifactRow, Asked, ArtifactRole] = ['by the session address', row, { userId: guest.id, tokenId: null, email: guest.email }, 'commenter'];
    expect(await effectiveRole(before[1], before[2])).toBe(before[3]);
    // Resolution stamps it, so it now follows the ACCOUNT through an address change.
    await setUserEmail(guest.id, 'mxmx_test_late_new@example.com');
    return [['by the account after an address change', row, { userId: guest.id, tokenId: null, email: 'mxmx_test_late_new@example.com' }, 'commenter']];
  }],
  ['an agent of an invited person reaches what its person does — no session address needed', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'private');
    const guest = await account('mxmx_test_agent_person@example.com');
    await shareWith(owner, row, guest.user.email!, 'editor');
    // A bearer token resolves to its user with NO email attached: the match has to go through users.email.
    return [['the bearer', row, { userId: guest.user.id, tokenId: guest.token.id, email: null }, 'editor']];
  }],
  ['an UNRESOLVED invite to an address the person no longer has grants nothing', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'private');
    const guest = await createUser({ email: 'mxmx_test_old@example.com' });
    await setUserEmail(guest.id, 'mxmx_test_new@example.com');
    await shareWith(owner, row, 'mxmx_test_old@example.com', 'editor');
    return [['the new address', row, { userId: guest.id, tokenId: null, email: 'mxmx_test_new@example.com' }, 'none']];
  }],
  ['the link grants a signed-in stranger exactly what it says', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = { userId: stranger.user.id, tokenId: null, email: stranger.user.email };
    const out: Array<[string, ArtifactRow, Asked, ArtifactRole]> = [];
    for (const role of SHARE_ROLE_LIST) out.push([`link ${role}`, await docOf(owner, 'public', role), asStranger, role]);
    return out;
  }],
  ['CAPS anonymous at viewer — a write needs an account, whatever the link grants', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const anonToken = await mintToken('anon-browser');
    const out: Array<[string, ArtifactRow, Asked, ArtifactRole]> = [];
    for (const role of ['commenter', 'editor'] as ShareRole[]) {
      const row = await docOf(owner, 'public', role);
      out.push([`link ${role}, nobody at all`, row, { userId: null, tokenId: null }, 'viewer']);
      // An anonymous TOKEN is not an account: attributable, but with no handle to show beside a comment.
      out.push([`link ${role}, an anonymous token`, row, { userId: null, tokenId: anonToken.id }, 'viewer']);
    }
    return out;
  }],
  ['still answers none to everyone on a private document, whatever the link column holds', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    return [['link editor, private', await docOf(owner, 'private', 'editor'), { userId: stranger.user.id, tokenId: null, email: stranger.user.email }, 'none']];
  }],
  ['takes the MAX of the link and a named share, in both directions', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const guest = await account('mxmx_test_guest@example.com');
    const asGuest = { userId: guest.user.id, tokenId: null, email: guest.user.email };
    const linkViews = await docOf(owner, 'public', 'viewer');
    await updateSharingFor({ tokenId: '', userId: owner.user.id }, linkViews.id, { shares: [{ email: guest.user.email!, role: 'editor' }] });
    const linkEdits = await docOf(owner, 'public', 'editor');
    await updateSharingFor({ tokenId: '', userId: owner.user.id }, linkEdits.id, { shares: [{ email: guest.user.email!, role: 'viewer' }] });
    return [
      ['the share is higher than the link', (await head(linkViews.id))!, asGuest, 'editor'],
      ['a viewer share cannot pull a link editor down', (await head(linkEdits.id))!, asGuest, 'editor'],
    ];
  }],
  // Every SETTING means both axes: the visibility tier and the role the link carries.
  ['leaves the owner untouched at every setting', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const out: Array<[string, ArtifactRow, Asked, ArtifactRole]> = [];
    for (const visibility of ['private', 'unlisted', 'public'] as Visibility[]) {
      for (const linkRole of [undefined, 'viewer', 'editor'] as (ShareRole | undefined)[]) {
        out.push([`${visibility}/${linkRole ?? 'default'}`, await docOf(owner, visibility, linkRole), { userId: owner.user.id, tokenId: null }, 'owner']);
      }
    }
    return out;
  }],
];

describe('effectiveRole — ownership, the share list and the link, composed by max', () => {
  it.each(ROLE_CASES)('%s', async (_name, build) => {
    for (const [asked, row, viewer, expected] of await build()) {
      expect([asked, await effectiveRole(row, viewer)]).toEqual([asked, expected]);
    }
  });
});

describe('canReadArtifact is canRead(effectiveRole) — and answers exactly what it did before', () => {
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
    for (const role of SHARE_ROLE_LIST) {
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
      { nodeId: 'root', baseEditId: row.edit_id, body: 'a stranger with the link says something' },
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
      { nodeId: 'root', baseEditId: row.edit_id, body: 'nope' },
      { kind: 'human', label: 'stranger', transport: 'browser' },
    );
    expect(made, 'the uniform miss').toBeNull();
  });

  it('lets a signed-in stranger EDIT a link-editable document, and refuses a link-commentable one', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = { tokenId: stranger.token.id, userId: stranger.user.id };

    const editable = await docOf(owner, 'public', 'editor');
    const ok = await applyEditFor(asStranger, editable.id, documentEdit(editable, { source: editable.source!.replace('hello', 'edited') }));
    expect(ok, JSON.stringify(ok)).toMatchObject({ applied: true });
    expect((await head(editable.id))?.source).toContain('edited');

    const commentable = await docOf(owner, 'public', 'commenter');
    const refused = await applyEditFor(asStranger, commentable.id, documentEdit(commentable, { source: commentable.source!.replace('hello', 'nope') }));
    expect(refused, 'a commenter link is not an edit link').toBeNull();
  });

  it('lets an authenticated link editor manage sharing', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const row = await docOf(owner, 'public', 'editor');
    expect(await getSharingFor({ tokenId: stranger.token.id, userId: stranger.user.id }, row.id)).not.toBeNull();
    expect(await updateSharingFor({ tokenId: stranger.token.id, userId: stranger.user.id }, row.id, { visibility: 'private' })).not.toBeNull();
  });
});

/**
 * A SHARE CARRIES A ROLE — and the third role is COMMENTER: a named person who
 * may read the document and annotate it (open threads, reply, resolve), and
 * may NOT edit, PUT, revert, delete, share or move. "Read / write / comment"
 * was the ask from the start; annotations arrived without the role.
 *
 * Editors may annotate too — a person who may change the text may certainly
 * comment on it — and a plain viewer may not: "anyone may read this" has never
 * meant "anyone may write on it".
 */
describe('the commenter role, through the routes', () => {
  beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));

  const BASE = 'http://localhost:3000';
  const sessionUser = { id: '', email: '' };
  const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
  const jreq = (path: string, method: string, body?: unknown, token?: string) =>
    new Request(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };
  const human = { kind: 'human' as const, label: null, transport: 'browser' as const };

  beforeEach(async () => {
    sessionUser.id = ''; sessionUser.email = '';
  });

  async function world() {
    const owner = await createUser({ email: 'mxmx_test_owner@example.com' });
    const to = await mintToken('owner', owner.id); await claimToken(owner.id, to.token);
    const commenter = await createUser({ email: 'mxmx_test_commenter@example.com' });
    const tc = await mintToken('commenter', commenter.id); await claimToken(commenter.id, tc.token);
    const viewer = await createUser({ email: 'mxmx_test_viewer@example.com' });
    const tv = await mintToken('viewer', viewer.id); await claimToken(viewer.id, tv.token);
    const editor = await createUser({ email: 'mxmx_test_editor@example.com' });
    const te = await mintToken('editor', editor.id); await claimToken(editor.id, te.token);
    const res = await createArtifactRoute(jreq('/api/artifacts', 'POST', { markup: '<div id="root"><p>hello</p></div>', visibility: 'private' }, to.token));
    const doc = await res.json();
    asSession(owner);
    const put = await putSharingRoute(jreq(`/api/my/artifacts/${doc.id}/sharing`, 'PUT', { shares: [
      { email: commenter.email, role: 'commenter' }, { email: viewer.email, role: 'viewer' }, { email: editor.email, role: 'editor' },
    ] }), params({ id: doc.id }));
    expect(put.status, await put.clone().text()).toBe(200);
    const row = (await getArtifactById(doc.id))!;
    return { owner, to, commenter, tc, viewer, tv, editor, te, doc, row };
  }

  describe('the commenter role', () => {
    it('is a share role the vocabulary and the parser know', () => {
      expect(SHARE_ROLES).toContain('commenter');
      expect(SHARE_ROLE_LABEL.commenter).toBe('can comment');
      expect(parseShareEntries([{ email: 'a@example.com', role: 'commenter' }])).toEqual([{ email: 'a@example.com', role: 'commenter' }]);
    });

    // That effectiveRole decides each share's role, and that a commenter READS a private document like any share,
    // are the effectiveRole table's "a named share grants exactly its role on a private document" and
    // "preserves every verdict the old pair gave" above.
    it('is stored and listed back', async () => {
      const w = await world();
      const listed = await (await getSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'GET'), params({ id: w.doc.id }))).json();
      expect(listed.shares.find((s: { email: string }) => s.email === w.commenter.email).role).toBe('commenter');
    });

    it('may open a thread, reply, and resolve — and so may an editor; a viewer may not', async () => {
      const w = await world();
      const input = { nodeId: 'root', baseEditId: w.row.edit_id, body: 'is this right?' };
      const opened = await createAnnotationFor({ tokenId: w.tc.id, userId: w.commenter.id }, w.doc.id, input, human);
      expect(opened && 'id' in opened, JSON.stringify(opened)).toBe(true);
      const id = (opened as { id: string }).id;
      const reply = await actOnAnnotationFor({ tokenId: w.tc.id, userId: w.commenter.id }, w.doc.id, id, { reply: 'still wondering' }, human);
      expect(reply && 'id' in reply).toBe(true);
      expect((await listAnnotationsFor({ tokenId: w.tc.id, userId: w.commenter.id }, w.doc.id))?.length).toBe(1);

      const head = (await getArtifactById(w.doc.id))!;
      const byEditor = await createAnnotationFor({ tokenId: w.te.id, userId: w.editor.id }, w.doc.id, { ...input, baseEditId: head.edit_id }, human);
      expect(byEditor && 'id' in byEditor, 'an editor may comment').toBe(true);

      const byViewer = await createAnnotationFor({ tokenId: w.tv.id, userId: w.viewer.id }, w.doc.id, { ...input, baseEditId: head.edit_id }, human);
      expect(byViewer, 'a viewer is refused with the uniform miss').toBeNull();
      expect(await listAnnotationsFor({ tokenId: w.tv.id, userId: w.viewer.id }, w.doc.id)).toBeNull();
    });

    it('may NOT edit, replace, or delete — every write door is the uniform 404', async () => {
      const w = await world();
      const edit = await editsRoute(jreq(`/api/artifacts/${w.doc.id}/edits`, 'POST', documentEditBody(w.row,{source:'<div><p>changed</p></div>'}), w.tc.token), params({ id: w.doc.id }));
      expect(edit.status).toBe(404);
      const put = await putArtifactRoute(jreq(`/api/artifacts/${w.doc.id}`, 'PUT', documentEditBody(w.row,{source:'<div><p>changed</p></div>',whole:true}), w.tc.token), params({ id: w.doc.id }));
      expect(put.status).toBe(404);
      expect((await getArtifactById(w.doc.id))!.version).toBe(1);
    });
  });
});

describe('what an editor may do with sharing', () => {
  const params=(id:string)=>({params:Promise.resolve({id})});
  async function person(name:string){
   const user=await createUser({email:`mxmx_test_${name}@example.com`}),token=await mintToken(name,user.id);
   await claimToken(user.id,token.token);
   return {user,token,actor:{userId:user.id,tokenId:token.id},session:{userId:user.id,email:user.email,emailVerified:true,credential:'session' as const}};
  }
  async function fixture(role:'viewer'|'commenter'|'editor',dataset=false){
   const owner=await person('sharing_owner'),editor=await person('sharing_editor');
   const r=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{...(dataset?{dataset:[{n:1}]}:{markup:'<p>shared</p>'}),visibility:'private'}}));
   expect(r.status).toBe(201);const {id}=await r.json();
   await updateSharingFor(owner.actor,id,{shares:[{email:editor.user.email,role}]});
   const save=(json:object)=>write(request(`/api/my/artifacts/${id}/sharing`,{method:'PUT',actor:editor.session,json}),params(id));
   return {owner,editor,id,save};
  }
  it.each(['viewer','commenter','editor'] as const)('sharing management requires edit access: %s',async role=>{
   const f=await fixture(role);
   expect((await read(request(`/api/my/artifacts/${f.id}/sharing`,{actor:f.editor.session}),params(f.id))).status).toBe(role==='editor'?200:404);
   for(const granted of ['viewer','commenter','editor'] as const){
    const r=await f.save({shares:[{email:f.editor.user.email,role},{email:'mxmx_test_recipient@example.com',role:granted}],visibility:'unlisted',linkRole:granted});
    expect(r.status).toBe(role==='editor'?200:404);
    if(role==='editor')expect(await r.json()).toMatchObject({visibility:'unlisted',linkRole:granted,shares:expect.arrayContaining([{email:'mxmx_test_recipient@example.com',role:granted}])});
   }
  });
  it('editors may remove shares, including their own, but cannot demote the owner',async()=>{
   const f=await fixture('editor');
   const r=await f.save({shares:[{email:f.owner.user.email,role:'viewer'}]});
   expect(r.status).toBe(200);
   const row=(await getArtifactById(f.id))!;
   expect(row.user_id).toBe(f.owner.user.id);
   expect(await effectiveRole(row,f.owner.actor)).toBe('owner');
   expect((await f.save({visibility:'public'})).status).toBe(404);
  });
  it('editors can configure writable datasets through sharing',async()=>{
   const f=await fixture('editor',true);
   expect((await f.save({access:'readwrite'})).status).toBe(200);
   expect((await getArtifactById(f.id))?.access).toBe('readwrite');
  });
  it('ownership, deletion and restoration remain outside editor sharing authority',async()=>{
   const f=await fixture('editor');
   expect((await f.save({shares:[{email:f.editor.user.email,role:'owner'}]})).status).toBe(400);
   expect((await remove(request(`/api/my/artifacts/${f.id}`,{method:'DELETE',actor:f.editor.session}),params(f.id))).status).toBe(404);
   expect((await remove(request(`/api/my/artifacts/${f.id}`,{method:'DELETE',actor:f.owner.session}),params(f.id))).status).toBe(200);
   expect((await restore(request(`/api/my/artifacts/${f.id}/restore`,{method:'POST',actor:f.editor.session}),params(f.id))).status).toBe(404);
   expect((await restore(request(`/api/my/artifacts/${f.id}/restore`,{method:'POST',actor:f.owner.session}),params(f.id))).status).toBe(200);
   expect((await getArtifactById(f.id))?.user_id).toBe(f.owner.user.id);
  });

  it('editors can change link access through the metadata API',async()=>{
   const f=await fixture('editor');
   const r=await metadata(await observedRequest(`/api/my/artifacts/${f.id}`,{method:'PATCH',actor:f.editor.session,json:{visibility:'unlisted',linkRole:'commenter'}}),params(f.id));
   expect(r.status).toBe(200);
   expect((await getArtifactById(f.id))?.link_role).toBe('commenter');
  });

  it('a link editor may apply one atomic patch that removes their access',async()=>{
   const f=await fixture('editor',true);
   await updateSharingFor(f.owner.actor,f.id,{visibility:'public',linkRole:'editor',shares:[]});
   const r=await f.save({visibility:'private',linkRole:'viewer',access:'readwrite'});
   expect(r.status).toBe(200);
   expect(await r.json()).toMatchObject({visibility:'private',linkRole:'viewer',access:'readwrite'});
   expect(await getArtifactById(f.id)).toMatchObject({visibility:'private',link_role:'viewer',access:'readwrite'});
  });
});

/**
 * Multi-user editing: a share carries a ROLE.
 *
 * Two orthogonal axes on an artifact — `visibility` is who may read via the
 * link, `artifact_shares` is the named people and what they may do
 * (`viewer` | `editor`) — and they apply under EVERY visibility, which is what
 * lets a public document have editors at all. Three relationships to a row,
 * decided once by `roleFor`:
 *
 *   owner  — everything
 *   editor — reach + edits/PUT/revert/versions; never delete, share, move, access
 *   reader — the read ACL, nothing more
 *
 * Tested through the ROUTES, both credentials — the earlier hole
 * (`mutate-csrf`) lived in the untested one. Every write here runs against the
 * SQL predicate, so a route this file does not reach is guarded by the same
 * scope the reached ones are.
 */
describe('editors through every door', () => {
  beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null, emailVerified: true } } : null)));
  const sessionUser = { id: '', email: '' };

  const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
  const jreq = async(path:string,method:string,body?:unknown,token?:string)=>{
   const match=path.match(/^\/api\/(?:my\/)?artifacts\/([^/]+)(?:\/(edits|revert))?$/);
   if(match&&body&&typeof body==='object'&&!Array.isArray(body)){
    const row=await getArtifactById(match[1]);
    if(row?.format==='markup'&&(match[2]||method==='PATCH')){
     let input=body as Record<string,unknown>;
     if(match[2]==='revert'){
      const archived=await getVersionFor({tokenId:row.token_id,userId:row.user_id},row.id,Number(input.version));
      if(!archived)throw new Error('Fixture archive missing');input={source:archived.source};
     }
     return request(path,{method:'POST',token,json:documentPublicationBody(row,input,match[2]==='revert')});
    }
   }
   return observedRequest(path,{method,json:body,token});
  };
  const create = async (token: string, body: Record<string, unknown>) => {
    const res = await createArtifactRoute(await jreq('/api/artifacts', 'POST', body, token));
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { id: string; edit_id: string; version: number };
  };
  const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };
  const noSession = () => { sessionUser.id = ''; sessionUser.email = ''; };

  const PROSE = '<div id="root"><p>hello</p></div>';
  const PROSE2 = '<div id="root"><p>hello again</p></div>';
  const ROWS = [{ choice: 'ramen' }];
  const MUTATING = (ds: string) =>
    '<Helmet><Value name="choice" type="string" default="ramen" />'
    + `<Import name="vote_data" src="ref:${ds}" /><Mutation name="vote">{\`insert into vote_data.rows (choice) values ($choice)\`}</Mutation></Helmet>`
    + '<div><Button run="$vote">Vote</Button></div>';
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  beforeEach(async () => {
    noSession();
  });

  /** Owner A with a public prose document; B and C are accounts with claimed tokens. */
  async function world(markup = PROSE, visibility: 'public' | 'private' = 'public') {
    const owner = await createUser({ email: 'owner@x.com' });
    const ta = await mintToken('a', owner.id);
      await claimToken(owner.id, ta.token);
    const bob = await createUser({ email: 'Bob@X.com' });
    const tb = await mintToken('b', bob.id);
    const bobNamed = await ensureUsername(bob);
    await claimToken(bob.id, tb.token);
    const carol = await createUser({ email: 'carol@x.com' });
    const tc = await mintToken('c', carol.id);
      await claimToken(carol.id, tc.token);
    const anon = await mintToken('anon', null);
    const doc = await create(ta.token, { markup, visibility });
    return { ta, tb, tc, anon, owner, bob: bobNamed, carol, doc };
  }

  const share = async (id: string, shares: unknown) => {
    const res = await putSharingRoute(await jreq(`/api/my/artifacts/${id}/sharing`, 'PUT', { shares }), params({ id }));
    return res;
  };
  const inviteEditor = async (w: Awaited<ReturnType<typeof world>>, email = 'bob@x.com') => {
    asSession({ id: w.owner.id, email: w.owner.email });
    const res = await share(w.doc.id, [{ email, role: 'editor' }]);
    expect(res.status, await res.clone().text()).toBe(200);
    noSession();
  };
  const head = async (id: string) => (await getArtifactById(id))!;

  describe('a viewer share is read-only, exactly as before', () => {
    it('an explicit viewer share is read-only: 404 on every /api/my write and on reach', async () => {
      const w = await world();
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(w.doc.id, [{email:'bob@x.com',role:'viewer'}])).status).toBe(200);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;
      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
      expect((await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(404);
      expect((await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
      expect((await versionsMineRoute(await jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }))).status).toBe(404);
      // …and the same through B's claimed bearer token.
      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }))).status).toBe(200);
    });
  });

  describe('an editor edits through every write door, and nothing else', () => {
    it('session: reach, edits, PUT, revert and versions answer; sharing answers too; delete and moving do not', async () => {
      const w = await world();
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;

      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(200);

      const edited = await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }));
      expect(edited.status, await edited.clone().text()).toBe(200);
      expect((await head(id)).source).toContain('hello again');

      const put = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE }), params({ id }));
      expect(put.status, await put.clone().text()).toBe(200);

      const versions = await versionsMineRoute(await jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }));
      expect(versions.status).toBe(200);
      const listed = (await versions.json()) as { versions: Array<{ version: number; by: string | null }> };
      expect(listed.versions.length).toBeGreaterThan(0);

      const revert = await revertMineRoute(await jreq(`/api/my/artifacts/${id}/revert`, 'POST', { version: 1 }), params({ id }));
      expect(revert.status, await revert.clone().text()).toBe(200);

      // Owner-only surfaces: the uniform 404, never "exists but not yours".
      expect((await deleteMineRoute(await jreq(`/api/my/artifacts/${id}`, 'DELETE'), params({ id }))).status).toBe(404);
      expect((await getSharingRoute(await jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }))).status).toBe(200);
      expect((await share(id, [{email:w.bob.email,role:'editor'}, { email: 'carol@x.com', role: 'editor' }])).status).toBe(200);
      // An editor can patch content metadata, but receives owner_only for placement.
      expect((await patchMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PATCH', { parent_id: null }), params({ id }))).status).toBe(403);
      expect(await head(id)).toBeTruthy();

      /*
       * …and PLACEMENT is the same verb through the REPLACE door, which an
       * editor DOES reach. `parent_id` on a PUT is owner-only (lib/artifacts
       * ownerScope: "delete, sharing, folder, dataset access, listing"), so the
       * editor's write is refused whole — `invalid_parent`, the one refusal
       * that already means "not a folder you may file into" — and the document
       * neither moves nor gains the version the rest of the body would have
       * bought. Without this the editor could file the owner's document into
       * any folder of theirs they can name, and `ancestor_ids` is in the
       * read-back, so naming one is free.
       */
      asSession({ id: w.owner.id, email: w.owner.email });
      const box = await create(w.ta.token, { format: 'folder', title: 'the owner\'s box' });
      asSession({ id: w.bob.id, email: w.bob.email });
      const before = (await head(id)).version;
      for (const parent_id of [box.id, null]) {
        const moved = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: PROSE2, parent_id }), params({ id }));
        expect(moved.status, await moved.clone().text()).toBe(403);
        expect(await moved.json()).toMatchObject({ error: 'owner_only' });
      }
      expect((await head(id)).ancestor_ids).toEqual([]);
      expect((await head(id)).version).toBe(before);
    });

    it('editors change visibility through both content replacement credentials', async () => {
      const w = await world(PROSE, 'private');
      await inviteEditor(w);
      const id = w.doc.id;
      asSession({id:w.bob.id,email:w.bob.email});
      const browser = await putMineRoute(await jreq(`/api/my/artifacts/${id}`,'PUT',{markup:PROSE2,visibility:'unlisted'}),params({id}));
      expect(browser.status,await browser.clone().text()).toBe(200);
      noSession();
      const bearer = await putArtifactRoute(await jreq(`/api/artifacts/${id}`,'PUT',{markup:PROSE2,visibility:'public'},w.tb.token),params({id}));
      expect(bearer.status,await bearer.clone().text()).toBe(200);
      expect((await getArtifactById(id))!.visibility).toBe('public');
    });

    it('bearer: the editor\'s CLAIMED token edits; an anonymous token and a stranger\'s token do not', async () => {
      const w = await world();
      await inviteEditor(w);
      const id = w.doc.id;
      const read = await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }));
      expect(read.status).toBe(200);
      const edited = await editsRoute(await jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }, w.tb.token), params({ id }));
      expect(edited.status, await edited.clone().text()).toBe(200);
      const put = await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', { markup: PROSE }, w.tb.token), params({ id }));
      expect(put.status, await put.clone().text()).toBe(200);

      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.anon.token), params({ id }))).status).toBe(401);
      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tc.token), params({ id }))).status).toBe(200);
      const h = await head(id);
      expect((await editsRoute(await jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: h.edit_id, source: PROSE2 }, w.tc.token), params({ id }))).status).toBe(404);
    });

    it('an editor\'s write resolves refs as the DOCUMENT\'s owner: a <Mutation> on the owner\'s dataset and a private image both publish', async () => {
      const w = await world();
      const ds = (await create(w.ta.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
      const img = (await create(w.ta.token, { image: PNG, visibility: 'private' })).id;
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;

      const withMutation = await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: MUTATING(ds) }), params({ id }));
      expect(withMutation.status, await withMutation.clone().text()).toBe(200);

      const withImage = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: `<div><img src="ref:${img}" alt="x" /></div>` }), params({ id }));
      expect(withImage.status, await withImage.clone().text()).toBe(200);

      // The bearer door too — it parses before it loads the row.
      const bearerPut = await putArtifactRoute(await jreq(`/api/artifacts/${id}`, 'PUT', { markup: MUTATING(ds) }, w.tb.token), params({ id }));
      expect(bearerPut.status, await bearerPut.clone().text()).toBe(200);
    });

    it('an image an editor pastes is imported for the DOCUMENT\'s owner, so the next edit still resolves it', async () => {
      const w = await world();
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;
      const img = await create(w.tb.token, { image: PNG }); // B's own upload (born unlisted) …
      const put = await putMineRoute(await jreq(`/api/my/artifacts/${id}`, 'PUT', { markup: `<div><img src="ref:${img.id}" alt="x" /></div>` }), params({ id }));
      expect(put.status, await put.clone().text()).toBe(200); // … is link-readable to the owner's loader.
    });
  });

  describe('an editor on a PRIVATE document', () => {
    it('reaches, edits, reads one archived version and mints an agent prompt — through a session and through their token', async () => {
      const w = await world(PROSE, 'private');
      await inviteEditor(w);
      const id = w.doc.id;
      asSession({ id: w.bob.id, email: w.bob.email });
      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(200);
      expect((await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(200);
      const one = await versionMineRoute(await jreq(`/api/my/artifacts/${id}/versions/1`, 'GET'), params({ id, version: '1' }));
      expect(one.status).toBe(200);
      expect(await one.json()).toMatchObject({ version: 1 });
      const prompt = await agentPromptRoute(await jreq(`/api/my/artifacts/${id}/agent-prompt`, 'POST', {}), params({ id }));
      expect(prompt.status, await prompt.clone().text()).toBe(201); // it mints a token for the editor's own agent
      // The stranger and the anonymous token still see nothing.
      asSession({ id: w.carol.id, email: w.carol.email });
      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
      expect((await versionMineRoute(await jreq(`/api/my/artifacts/${id}/versions/1`, 'GET'), params({ id, version: '1' }))).status).toBe(404);
      noSession();
      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.tb.token), params({ id }))).status).toBe(200);
      expect((await getArtifactRoute(await jreq(`/api/artifacts/${id}`, 'GET', undefined, w.anon.token), params({ id }))).status).toBe(401);
    });

    it('naming the OWNER\'s own email changes nothing — they stay the owner', async () => {
      const w = await world();
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(w.doc.id, [{ email: w.owner.email, role: 'viewer' }])).status).toBe(200);
      expect(await roleFor(await head(w.doc.id), { userId: w.owner.id, tokenId: null })).toBe('owner');
      expect((await getSharingRoute(await jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'GET'), params({ id: w.doc.id }))).status).toBe(200);
    });

    it('lib/viewer wraps the same decision for a request actor (session, agent cookie, nobody)', async () => {
      const w = await world();
      await inviteEditor(w);
      const row = await head(w.doc.id);
      expect(await requestRoleFor(row, { viewer: { userId: w.owner.id, email: w.owner.email }, tokenId: null, credential: 'session' })).toBe('owner');
      expect(await requestRoleFor(row, { viewer: { userId: w.bob.id, email: null }, tokenId: w.tb.id, credential: 'bearer' })).toBe('editor');
      expect(await requestRoleFor(row, { viewer: { userId: w.owner.id, email: w.owner.email }, tokenId: w.ta.id, credential: 'bearer' })).toBe('owner');
      expect(await requestRoleFor(row, { viewer: null, tokenId: w.ta.id, credential: 'agent-cookie' })).toBe('viewer');
      expect(await requestRoleFor(row, { viewer: null, tokenId: w.anon.id, credential: 'agent-cookie' })).toBe('viewer');
      expect(await requestRoleFor(row, { viewer: null, tokenId: null, credential: 'none' })).toBe('viewer');
    });
  });

  describe('who wrote: edits, versions and the head carry the actor', () => {
    it('stamps the editor on the edit log and the head; the archived version names the previous author by username', async () => {
      const w = await world();
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;
      const edited = await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }));
      expect(edited.status).toBe(200);
      const db = await harness.db();
      const log = await db.query<{ actor_user_id: string | null }>('SELECT actor_user_id FROM artifact_edits WHERE artifact_id = $1 ORDER BY seq DESC LIMIT 1', [id]);
      expect(log.rows[0].actor_user_id).toBe(w.bob.id);
      expect((await head(id)).actor_user_id).toBe(w.bob.id);

      // The version archived by that edit is v1, whose author was the OWNER.
      const versions = await versionsMineRoute(await jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params({ id }));
      const listed = (await versions.json()) as { versions: Array<{ version: number; by: string | null }> };
      expect(listed.versions[0].version).toBe(1);
      expect(listed.versions[0].by).toBeNull(); // the owner has no username yet — by is a handle, never an email
    });
  });

  describe('the live stream says who moved the document', () => {
    it('the first frame after an editor\'s write carries their handle in `by`', async () => {
      const w = await world();
      await inviteEditor(w);
      asSession({ id: w.bob.id, email: w.bob.email });
      const id = w.doc.id;
      expect((await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(200);
      noSession();
      const res = await eventsRoute(await jreq(`/a/${id}/events`, 'GET'), params({ id }));
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      const frame = JSON.parse(new TextDecoder().decode(value).split('\n').find((l) => l.startsWith('data:'))!.slice(5));
      expect(frame).toMatchObject({ by: w.bob.username, version: 2 });
    });
  });

  describe('the share list carries roles', () => {
    it('GET returns entries; PUT requires explicit roles and rejects ambiguous grants', async () => {
      const w = await world();
      asSession({ id: w.owner.id, email: w.owner.email });
      const id = w.doc.id;
      expect((await share(id, [{ email:'Bob@X.com', role:'viewer' }, { email: 'carol@x.com', role: 'editor' }])).status).toBe(200);
      const got = await getSharingRoute(await jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }));
      expect(await got.json()).toMatchObject({
        visibility: 'public',
        shares: [{ email: 'bob@x.com', role: 'viewer' }, { email: 'carol@x.com', role: 'editor' }],
      });
      expect((await share(id, [{ email: 'bob@x.com', role: 'owner' }])).status).toBe(400);
      expect((await share(id, [{ email: 'nope', role: 'editor' }])).status).toBe(400);
      expect((await share(id, [{ role: 'editor' }])).status).toBe(400);
      // Conflicting duplicate roles are rejected; legacy strings are not accepted.
      expect((await share(id, ['bob@x.com'])).status).toBe(400);
      expect((await share(id, [{email:'bob@x.com',role:'viewer'}, { email: 'BOB@x.com', role: 'editor' }])).status).toBe(400);
      expect((await share(id, [{email:'bob@x.com',role:'editor'}, { email: 'BOB@x.com', role: 'editor' }])).status).toBe(200);
      const again = (await (await getSharingRoute(await jreq(`/api/my/artifacts/${id}/sharing`, 'GET'), params({ id }))).json()) as { shares: unknown[] };
      expect(again.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
    });

    it('demoting or removing an editor takes effect on their very next write', async () => {
      const w = await world();
      await inviteEditor(w);
      const id = w.doc.id;
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(id, [{ email: 'bob@x.com', role: 'viewer' }])).status).toBe(200);
      asSession({ id: w.bob.id, email: w.bob.email });
      expect((await editsMineRoute(await jreq(`/api/my/artifacts/${id}/edits`, 'POST', { edit_id: w.doc.edit_id, source: PROSE2 }), params({ id }))).status).toBe(404);
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(id, [])).status).toBe(200);
      asSession({ id: w.bob.id, email: w.bob.email });
      expect((await getMineRoute(await jreq(`/api/my/artifacts/${id}`, 'GET'), params({ id }))).status).toBe(404);
    });

    it('an email account owner may name an editor through the owner scope', async () => {
      const anon = await mintToken('solo');
      const doc = await create(anon.token, { markup: PROSE });
      const bob = await createUser({ email: 'bob@x.com' });
      const tb = await mintToken('b', bob.id);
      await claimToken(bob.id, tb.token);
      // The library call uses the same email account owner scope as browser sharing.
      const { updateSharingFor } = await import('@/lib/artifacts');
      const state = await updateSharingFor({ tokenId:anon.id,userId:anon.userId }, doc.id, { shares: [{ email: 'bob@x.com', role: 'editor' }] });
      expect(state?.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
      const id = doc.id;
      expect((await editsRoute(await jreq(`/api/artifacts/${id}/edits`, 'POST', { edit_id: doc.edit_id, source: PROSE2 }, tb.token), params({ id }))).status).toBe(200);
    });
  });

  /*
   * A document two people may WRITE should not be a document only one may
   * DISCUSS. Creation was owner-only by accident, not by decision: it reads the
   * artifact through `actorScope`, which is `ownerScope`, so a collaborator's
   * session met the uniform 404 on the way in.
   */
  describe('a named editor may comment; deletion stays narrower', () => {
    const annotate = async (id: string, body: unknown) =>
      createAnnotationRoute(await jreq(`/api/my/artifacts/${id}/annotations`, 'POST', body), params({ id }));

    it('an editor creates and replies; a viewer and a stranger get the uniform 404', async () => {
      const w = await world();
      await inviteEditor(w);
      const id = w.doc.id;

      // The editor comments on the document's only paragraph.
      asSession({ id: w.bob.id, email: w.bob.email });
      const made = await annotate(id, { node_id: 'root', edit_id: (await head(id)).edit_id, body: 'is this the right number?' });
      expect(made.status, await made.clone().text()).toBe(201);
      const ann = (await made.json()) as { id: string; thread: Array<{ author: { label: string | null } }> };
      // The author snapshot is the EDITOR, not the document's owner.
      expect(ann.thread[0].author.label).toBe(w.bob.username);

      // …and replies to it.
      const replied = await actOnAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${ann.id}`, 'POST', { reply: 'checked, it is' }),
        params({ id, annId: ann.id }),
      );
      expect(replied.status, await replied.clone().text()).toBe(200);

      // A viewer share may read the document and nothing else.
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(id, [{ email: 'bob@x.com', role: 'editor' }, { email: 'carol@x.com', role: 'viewer' }])).status).toBe(200);
      asSession({ id: w.carol.id, email: w.carol.email });
      expect((await annotate(id, { node_id: 'root', edit_id: (await head(id)).edit_id, body: 'nope' })).status).toBe(404);

      // A stranger with no share at all.
      noSession();
      expect((await annotate(id, { node_id: 'root', edit_id: (await head(id)).edit_id, body: 'nope' })).status).toBe(401);
    });

    it('the owner erases any thread; an editor erases only their own', async () => {
      const w = await world();
      await inviteEditor(w);
      const id = w.doc.id;

      asSession({ id: w.owner.id, email: w.owner.email });
      const byOwner = (await (await annotate(id, { node_id: 'root', edit_id: (await head(id)).edit_id, body: 'owner note' })).json()) as { id: string };
      const ownerReplyResponse = await actOnAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'POST', { reply: 'owner reply' }),
        params({ id, annId: byOwner.id }),
      );
      const ownerReply = (await ownerReplyResponse.json() as { thread: Array<{ id: string }> }).thread[1]!;

      asSession({ id: w.bob.id, email: w.bob.email });
      const byEditor = (await (await annotate(id, { node_id: 'root', edit_id: (await head(id)).edit_id, body: 'editor note' })).json()) as { id: string };
      const editorReplyResponse = await actOnAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'POST', { reply: 'editor reply' }),
        params({ id, annId: byOwner.id }),
      );
      const editorReply = (await editorReplyResponse.json() as { thread: Array<{ id: string }> }).thread[2]!;

      // A reply is independently deletable, with the same author check as a root.
      const refusedReply = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${ownerReply.id}`, 'DELETE'), params({ id, annId: ownerReply.id }),
      );
      expect(refusedReply.status).toBe(404);
      const ownReply = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${editorReply.id}`, 'DELETE'), params({ id, annId: editorReply.id }),
      );
      expect(ownReply.status, await ownReply.clone().text()).toBe(200);

      // The editor may not erase the owner's words…
      const refused = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'DELETE'), params({ id, annId: byOwner.id }),
      );
      expect(refused.status).toBe(404);

      // …but may take back their own.
      const own = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byEditor.id}`, 'DELETE'), params({ id, annId: byEditor.id }),
      );
      expect(own.status, await own.clone().text()).toBe(200);

      // The owner erases anything on their document.
      asSession({ id: w.owner.id, email: w.owner.email });
      const ownerDeletes = await deleteAnnotationRoute(
        await jreq(`/api/my/artifacts/${id}/annotations/${byOwner.id}`, 'DELETE'), params({ id, annId: byOwner.id }),
      );
      expect(ownerDeletes.status, await ownerDeletes.clone().text()).toBe(200);
    });
  });

  describe('roleFor and the read ACL', () => {
    it('names owner / editor / viewer for both credential shapes; an anonymous token is never an editor', async () => {
      const w = await world();
      await inviteEditor(w);
      const row = await head(w.doc.id);
      expect(await roleFor(row, { userId: w.owner.id, tokenId: null })).toBe('owner');
      expect(await roleFor(row, { userId: w.owner.id, tokenId: w.ta.id })).toBe('owner');
      expect(await roleFor(row, { userId: null, tokenId: w.ta.id })).toBe('viewer');
      expect(await roleFor(row, { userId: w.bob.id, tokenId: null })).toBe('editor');
      expect(await roleFor(row, { userId: w.bob.id, tokenId: w.tb.id })).toBe('editor');
      expect(await roleFor(row, { userId: w.carol.id, tokenId: null }), 'a public link grants a view').toBe('viewer');
      expect(await roleFor(row, { userId: null, tokenId: w.anon.id })).toBe('viewer');
      expect(await roleFor(row, { userId: null, tokenId: null })).toBe('viewer');
    });

    it('a private document shared to an email is readable by that account\'s TOKEN viewer too (email: null)', async () => {
      const w = await world(PROSE, 'private');
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(w.doc.id, [{email:'bob@x.com',role:'viewer'}])).status).toBe(200);
      const row = await head(w.doc.id);
      expect(await canReadArtifact(row, { userId: w.bob.id, email: null })).toBe(true);
      expect(await canReadArtifact(row, { userId: w.bob.id, email: 'bob@x.com' })).toBe(true);
      expect(await canReadArtifact(row, { userId: w.carol.id, email: null })).toBe(false);
      expect(await canReadArtifact(row, null)).toBe(false);
    });
  });

  /**
   * Invited email accounts can use their complete grant through a bearer alone.
   * Token issuance establishes the email account before any artifact API call;
   * these callers never need a browser session to list, read, edit, or comment.
   */
  describe('an invited account that has only ever presented a bearer token', () => {
    /** The pair a CLI request really carries: the bearer header AND the proxy's verdict on it. */
    async function cliCaller(userId: string, email: string) {
      const db = await harness.db();
      await db.query("INSERT INTO users (id,email,kind) VALUES ($1,$2,'account')", [userId, email]);
      const minted = await mintToken('cli', userId);
      return async (path: string, method = 'GET', body?: unknown) =>
        attachActor(
          await observedRequest(path, { method, token: minted.token, ...(body === undefined ? {} : { json: body }) }),
          { credential: 'bearer', tokenId: minted.id, userId, email, emailVerified: true },
        );
    }

    // lib/profiles remembers what it has already written, per process — so each
    // case names its own person rather than sharing one across a wiped database.
    let people = 0;

    /** Owner A's PRIVATE document, invited to an email account with no browser session. */
    async function invitedTo(role: 'viewer' | 'commenter' | 'editor') {
      const who = `cli${people++}`, userId = `usr_${who}`, email = `${who}@invited.example`;
      const w = await world(PROSE, 'private');
      asSession({ id: w.owner.id, email: w.owner.email });
      expect((await share(w.doc.id, [{ email, role }])).status).toBe(200);
      noSession();
      const call = await cliCaller(userId, email);
      // Issuance already established the email account; no browser visit is needed.
      const db = await harness.db();
      expect((await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])).rows).toEqual([{ email }]);
      return { w, call, id: w.doc.id, userId, email };
    }

    const listedIds = async (response: Response) =>
      ((await response.json()) as { artifacts: Array<{ id: string }> }).artifacts.map((a) => a.id);

    it('an EDITOR lists, reads and writes the document using its issued email account', async () => {
      const { call, id, userId, email } = await invitedTo('editor');

      // The pull FIRST: an editor's read rechecks the edit predicate
      // (artifact-read readArtifactSnapshot), which is where it used to 404 while
      // a commenter's read of the same document answered.
      const read = await getArtifactRoute(await call(`/api/artifacts/${id}`), params({ id }));
      expect(read.status, await read.clone().text()).toBe(200);

      const listed = await listArtifactsRoute(await call('/api/artifacts'));
      expect(listed.status).toBe(200);
      expect(await listedIds(listed)).toEqual([id]);

      const put = await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }));
      expect(put.status, await put.clone().text()).toBe(200);
      expect((await head(id)).source).toContain('hello again');

      const db = await harness.db();
      expect((await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])).rows[0]?.email).toBe(email);
    });

    it('a COMMENTER comments, and still may not rewrite the document', async () => {
      const { call, id } = await invitedTo('commenter');

      const made = await annotateBearerRoute(await call(`/api/artifacts/${id}/annotations`, 'POST', { quote: 'hello', body: 'looks right to me' }), params({ id }));
      expect(made.status, await made.clone().text()).toBe(201);

      expect((await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
    });

    it('a VIEWER reads and lists, but neither writes nor comments', async () => {
      const { call, id } = await invitedTo('viewer');

      expect(await listedIds(await listArtifactsRoute(await call('/api/artifacts')))).toEqual([id]);
      expect((await getArtifactRoute(await call(`/api/artifacts/${id}`), params({ id }))).status).toBe(200);
      expect((await putArtifactRoute(await call(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
      expect((await annotateBearerRoute(await call(`/api/artifacts/${id}/annotations`, 'POST', { quote: 'hello', body: 'nope' }), params({ id }))).status).toBe(404);
    });

    it('an account nobody invited keeps the uniform 404 and an empty listing', async () => {
      const { id } = await invitedTo('editor');
      const stranger = await cliCaller('usr_cli_stranger', 'cli-stranger@invited.example');

      expect(await listedIds(await listArtifactsRoute(await stranger('/api/artifacts')))).toEqual([]);
      expect((await getArtifactRoute(await stranger(`/api/artifacts/${id}`), params({ id }))).status).toBe(404);
      expect((await putArtifactRoute(await stranger(`/api/artifacts/${id}`, 'PUT', { markup: PROSE2 }), params({ id }))).status).toBe(404);
      expect((await annotateBearerRoute(await stranger(`/api/artifacts/${id}/annotations`, 'POST', { quote: 'hello', body: 'no' }), params({ id }))).status).toBe(404);
    });
  });

  describe('the browser edit answer', () => {
    it('is the patch when it landed where it was prepared: advancing the editor graph by it gives exactly the stored document', async () => {
      const w = await world('<div id="d"><p id="a">one</p><p id="b">two</p></div>');
      asSession({ id: w.owner.id, email: w.owner.email });
      const id = w.doc.id;
      const base = await head(id);
      const sent = documentEditBody(base, { source: '<div id="d"><p id="a">one, typed</p><p id="b">two</p></div>' });
      const res = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: sent }), params({ id }));
      expect(res.status, await res.clone().text()).toBe(200);
      const answer = await res.json();
      expect(answer.document).toBeUndefined();
      expect(answer.markup).toBeUndefined();
      expect(answer).toMatchObject({ version: base.version + 1, patch: sent.document_update.patch });
      const read = await (await getMineRoute(await request(`/api/my/artifacts/${id}`, {}), params({ id }))).json();
      const advanced = advanceGraph(base.document as never, base.version, answer.patch)!;
      expect(advanced).toEqual(read.document);
      expect(graphSource(advanced)).toBe(read.markup);
      expect(answer.edit_id).toBe(read.edit_id);

      // ?echo=full keeps the bearer route's answer for any caller that wants the document.
      const now = await head(id);
      const echoed = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits?echo=full`, { method: 'POST', json: documentEditBody(now, { source: (now.source as string).replace('one, typed', 'one') }) }), params({ id }));
      expect(echoed.status).toBe(200);
      expect((await echoed.json()).document.kind).toBe('graph');
    });

    it('a patch on a newer head answers without the document: replaying the patches between and its own gives exactly the stored head', async () => {
      const w = await world('<div id="d"><p id="a">one</p><p id="b">two</p><p id="c">three</p></div>');
      asSession({ id: w.owner.id, email: w.owner.email });
      const id = w.doc.id;
      const base = await head(id);
      // Two collaborators commit to other nodes first; the editor's save was prepared on `base`.
      for (const [from, to] of [['one', 'one, remote'], ['three', 'three, remote']]) {
        const now = await head(id);
        const res = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: documentEditBody(now, { source: (now.source as string).replace(from, to) }) }), params({ id }));
        expect(res.status, await res.clone().text()).toBe(200);
      }
      const sent = documentEditBody(base, { source: '<div id="d"><p id="a">one</p><p id="b">two, typed</p><p id="c">three</p></div>' });
      const res = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: sent }), params({ id }));
      expect(res.status, await res.clone().text()).toBe(200);
      const text = await res.text();
      const answer = JSON.parse(text);
      for (const key of ['document', 'markup', 'state', 'mutations']) expect(answer, key).not.toHaveProperty(key);
      expect(answer).toMatchObject({ version: base.version + 3, patch: sent.document_update.patch });
      expect(answer.remote_patches.map((step: { version: number }) => step.version)).toEqual([base.version + 1, base.version + 2]);
      let graph = base.document as never;
      for (const step of [...answer.remote_patches, { version: answer.version, patch: answer.patch }]) graph = advanceGraph(graph, step.version - 1, step.patch)! as never;
      const read = await (await getMineRoute(await request(`/api/my/artifacts/${id}`, {}), params({ id }))).json();
      expect(graph).toEqual(read.document);
      expect(graphSource(graph)).toBe(read.markup);
      expect(read.markup).toContain('one, remote');
      expect(read.markup).toContain('three, remote');
      expect(read.markup).toContain('two, typed');
      expect(answer.edit_id).toBe(read.edit_id);

      // A version between with no logged patch (a replacement, a conversion) leaves nothing to replay: the answer still
      // withholds the document, and says nothing about the versions between, so the editor reads the head itself.
      const from = await head(id);
      const remote = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: documentEditBody(from, { source: (from.source as string).replace('three, remote', 'three, again') }) }), params({ id }));
      expect(remote.status, await remote.clone().text()).toBe(200);
      await (await getDb()).query(`DELETE FROM artifact_edits WHERE artifact_id=$1 AND (document_state->>'version')::int=$2`, [id, from.version + 1]);
      const late = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits`, { method: 'POST', json: documentEditBody(from, { source: (from.source as string).replace('two, typed', 'two, typed again') }) }), params({ id }));
      expect(late.status, await late.clone().text()).toBe(200);
      const lateAnswer = await late.json();
      expect(lateAnswer.document).toBeUndefined();
      expect(lateAnswer.remote_patches).toBeUndefined();
      expect(lateAnswer.version).toBe(from.version + 2);
    });

    it('withholds the new document: no markup, state or mutations, and the head is settled after the answer exactly as an answered commit settles it', async () => {
      const DATA = (n: number) => `<Helmet><Value name="n" type="number" default={${n}} /><Query name="q">{\`select $n * 21 as n\`}</Query></Helmet><div><p id="a">Answer <Number data="$q" col="n" /></p><Mermaid title="D0" code={${JSON.stringify('flowchart LR\n  a[Request] --> b[Read]')}} /></div>`;
      const w = await world(DATA(2));
      asSession({ id: w.owner.id, email: w.owner.email });
      const twin = await create(w.ta.token, { markup: DATA(2), visibility: 'public' });
      const edit = async (id: string, echo: string) => {
        const base = await head(id);
        const res = await editsMineRoute(await request(`/api/my/artifacts/${id}/edits${echo}`, { method: 'POST', json: documentEditBody(base, { source: (base.source as string).replace('default={2}', 'default={3}') }) }), params({ id }));
        expect(res.status, await res.clone().text()).toBe(200);
        return { base, text: await res.text() };
      };
      const { base, text } = await edit(w.doc.id, '');
      const answer = JSON.parse(text);
      for (const key of ['document', 'markup', 'state', 'mutations']) expect(answer, key).not.toHaveProperty(key);
      expect(answer).toMatchObject({ id: w.doc.id, version: base.version + 1, edit_id: expect.any(String) });
      expect(answer).toHaveProperty('theme');
      expect(answer.patch).toBeDefined();
      expect(text.length).toBeLessThan(JSON.stringify(base.document).length);

      // The twin takes the same edit on the answered path, which settles inline; both heads end the same.
      // The withheld answer is the full answer's head, every other key included (a new column rides along).
      const full = JSON.parse((await edit(twin.id, '?echo=full')).text);
      const without = (keys: string[], drop: string[]) => keys.filter((k) => !drop.includes(k)).sort();
      expect(without(Object.keys(answer), ['patch'])).toEqual(without(Object.keys(full), ['document', 'markup', 'state', 'mutations']));
      await committedHeadsSettled();
      const [settled, answered] = [await getArtifactById(w.doc.id), await getArtifactById(twin.id)];
      // The two documents differ only in their stamped node ids (same length), so the stored records are the same
      // compiled dataflow, each certified against its own head's source.
      const record = (row: typeof settled) => storedCompiledDataflow(row!.meta, row!.source!);
      expect(record(settled)).not.toBeNull();
      expect(record(settled)).toEqual(record(answered));
      const db = await getDb();
      const harvests = async (id: string) => (await db.query<{ version: number }>('SELECT version FROM mermaid_harvests WHERE artifact_id=$1 ORDER BY version', [id])).rows.map((r) => r.version);
      expect(await harvests(w.doc.id)).toContain(settled!.version);
      expect(await harvests(twin.id)).toContain(answered!.version);

      // The first edit after a quiet spell archives the version it replaced, copied as stored: the archive is exactly
      // the pre-edit head, document and all.
      const archived = await getVersionFor({ userId: base.user_id, tokenId: base.token_id }, w.doc.id, base.version);
      expect(archived?.source).toBe(base.source);
      expect((await db.query<{ document: unknown }>('SELECT document FROM artifact_versions WHERE artifact_id=$1 AND version=$2', [w.doc.id, base.version])).rows[0]?.document).toEqual(base.document);
    });
  });
});

describe('artifact membership', () => {
  async function world() {
    const owner = await createUser({ email: 'mxmx_test_members_owner@example.com' });
    const bob = await createUser({ email: 'mxmx_test_members_bob@example.com' });
    const eve = await createUser({ email: 'mxmx_test_members_eve@example.com' });
    const db = await getDb();
    for (const [user, username] of [[owner,'member_owner'],[bob,'member_bob'],[eve,'member_eve']] as const) await db.query('UPDATE users SET username=$2 WHERE id=$1',[user.id,username]);
    await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,link_role) VALUES('a1B2c3','owner-token',$1,'markup','public','commenter')",[owner.id]);
    return { db, owner, bob, eve, actor: (user: {id:string}) => ({ userId:user.id,tokenId:null }) };
  }
  it('joins an owner immediately; readers request and only an editor can approve', async () => {
    const w=await world();
    expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'join'})).self?.status).toBe('accepted');
    expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('pending');
    await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/approve/i);
    await changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id});
    expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.joined_at).toBeTruthy();
    await changeMembership(w.actor(w.bob),'a1B2c3',{action:'leave'});
    expect((await membershipState(w.actor(w.bob),'a1B2c3')).members.map(m=>m.user_id)).not.toContain(w.bob.id);
  });
  it('uses recipient-follows-sender direction for candidates and autoaccept, including agents', async () => {
    const w=await world();
    await link(w.bob.id,'follow',w.owner.id);
    await link(w.owner.id,'follow',w.eve.id);
    expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member')).toEqual(expect.arrayContaining([expect.objectContaining({ user_id:w.bob.id })]));
    expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_eve')).toEqual([]);
    await changeMembership({...w.actor(w.owner),tokenId:'agent-token'},'a1B2c3',{action:'invite',usernames:['@member_bob']});
    expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('accepted');
    expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve']})).pending).toEqual([expect.objectContaining({user_id:w.eve.id})]);
  });
  it('keeps invitations pending when autoaccept is disabled; only the recipient accepts', async () => {
    const w=await world();
    await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
    await link(w.bob.id,'follow',w.owner.id);
    await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
    await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/recipient/i);
    expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'accept'})).self?.status).toBe('accepted');
  });
  it('keeps repeated requests idempotent and pending identities private', async () => {
    const w=await world();
    await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
    await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
    expect((await membershipState(w.actor(w.eve),'a1B2c3')).pending).toEqual([]);
    expect((await membershipState(w.actor(w.owner),'a1B2c3')).pending).toHaveLength(1);
    expect((await w.db.query('SELECT * FROM member_notifications WHERE recipient_id=$1',[w.owner.id])).rows).toHaveLength(1);
  });
  it('rechecks access before approving and refuses anonymous participation', async () => {
    const w=await world();
    await expect(changeMembership({userId:null,tokenId:null},'a1B2c3',{action:'join'})).rejects.toThrow(/sign in/i);
    await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
    await w.db.query("UPDATE artifacts SET visibility='private',sharing_revision=sharing_revision+1 WHERE id='a1B2c3'");
    await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id})).rejects.toThrow(/access/i);
  });
  it('caps outstanding requests across artifacts and frees slots on withdrawal', async () => {
    const w=await world();
    for(let i=0;i<30;i++) {
      const id=`cap${String(i).padStart(3,'0')}`;
      await w.db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility) VALUES($1,'owner-token',$2,'markup','public')",[id,w.owner.id]);
      await changeMembership(w.actor(w.bob),id,{action:'join'});
    }
    await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).rejects.toThrow(/30/);
    await changeMembership(w.actor(w.bob),'cap000',{action:'leave'});
    expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('pending');
  });

  it('the browser handler keeps comment access independent and refuses cross-site membership changes', async () => {
    const w=await world();
    const ctx={params:Promise.resolve({id:'a1B2c3'})};
    const actor={credential:'session' as const,userId:w.bob.id,email:w.bob.email!,emailVerified:true};
    const response=await POST(request('/api/my/artifacts/a1B2c3/members',{method:'POST',origin:'same',actor,json:{action:'join'}}),ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).self.status).toBe('pending');
    expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.bob))).toBe('commenter');
    const cross=await POST(request('/api/my/artifacts/a1B2c3/members',{method:'POST',origin:'https://outside.example',actor,json:{action:'leave'}}),ctx);
    expect(cross.status).toBe(403);
  });

  it('commits resolved mentions once, reuses pending requests, and refuses blocked recipients',async()=>{
   const w=await world();await link(w.bob.id,'follow',w.owner.id);
   await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
   const mention=(source:string)=>w.db.transaction(async tx=>{const row=(await tx.query<any>("SELECT * FROM artifacts WHERE id='a1B2c3' FOR UPDATE")).rows[0];await invitePeople(tx,row,w.actor(w.owner),[w.bob.id],source);});
   await mention('comment:one');await mention('comment:one');await mention('comment:two');
   expect((await w.db.query("SELECT * FROM member_notifications WHERE kind<>'follow'")).rows).toHaveLength(1);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'accept'});
   await mention('comment:three');await mention('comment:three');
   expect((await w.db.query("SELECT * FROM member_notifications WHERE kind='mention'")).rows).toHaveLength(1);
   await w.db.query('INSERT INTO user_blocks(user_id,blocked_user_id) VALUES($1,$2)',[w.bob.id,w.owner.id]);
   expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','')).toEqual([]);
   await expect(mention('comment:blocked')).rejects.toThrow('eligible');
  });

  it('posts resolved comment mentions atomically for agents and ignores examples in code',async()=>{
   const w=await world();await link(w.bob.id,'follow',w.owner.id);
   await w.db.query(`UPDATE artifacts SET source='<p id="mark">Hello</p>' WHERE id='a1B2c3'`);
   const actor={userId:w.owner.id,tokenId:'owner-token'};
   const post=(body:string)=>createAnnotationFor(actor,'a1B2c3',{nodeId:'mark',body},{kind:'agent',label:'test',transport:'http'});
   expect(await post('`[@member_bob](/people/'+w.bob.id+')`')).not.toBeNull();
   expect((await membershipInbox(w.actor(w.bob))).notifications).toHaveLength(0);
   const result=await post('[@member_bob](/people/'+w.bob.id+')');expect(result).not.toBeInstanceOf(Response);
   expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('accepted');
   const inbox=await membershipInbox(w.actor(w.bob));expect(inbox.notifications).toHaveLength(1);
   expect(inbox.notifications[0].source).toMatch(/^comment:/);
   await updateMembershipInbox(w.actor(w.bob),{autoAccept:false,block:w.owner.id});
   expect((await membershipInbox(w.actor(w.bob))).autoAccept).toBe(false);
   const refused=await post('[@member_bob](/people/'+w.bob.id+')');expect(refused).toBeInstanceOf(Response);expect((refused as Response).status).toBe(403);
   expect((await w.db.query('SELECT * FROM annotations')).rows).toHaveLength(2);
  });

  it('permits explicit invitations without a follow',async()=>{
   const w=await world();
   expect((await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).pending).toHaveLength(1);
  });
  it('refuses another unsolicited invitation after dismissal',async()=>{
   const w=await world();await link(w.bob.id,'follow',w.owner.id);
   await w.db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[w.bob.id]);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'dismiss'});
   await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).rejects.toThrow();
  });
  it('gives an existing requester instant membership after receiving edit access',async()=>{
   const w=await world();await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
   await w.db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES('a1B2c3',$1,$2,'editor')",[w.bob.id,w.bob.email]);
   expect((await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'})).self?.status).toBe('accepted');
  });
  it('includes viewing access atomically only when explicitly requested by an editor',async()=>{
   const w=await world();await w.db.query("UPDATE artifacts SET visibility='private' WHERE id='a1B2c3'");
   await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']})).rejects.toThrow(/access/);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob'],includeAccess:true});
   expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.bob))).toBe('viewer');
   expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('pending');
   await expect(changeMembership(w.actor(w.bob),'a1B2c3',{action:'invite',usernames:['@member_eve'],includeAccess:true})).rejects.toThrow(/owners and editors/);
   await expect(changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve','@missing'],includeAccess:true})).rejects.toThrow();
   expect(await effectiveRole((await getArtifactById('a1B2c3'))!,w.actor(w.eve))).toBe('none');
  });
  it('keeps mention autocomplete restricted while explicit invitations can find non-followers',async()=>{
   const w=await world();
   expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_bob')).toEqual([]);
   expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_bob','invite')).toEqual([expect.objectContaining({user_id:w.bob.id})]);
  });

  it('does not let a new artifact bypass a dismissed invitation',async()=>{
   const w=await world();
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'dismiss'});
   await w.db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,link_role) VALUES('d4E5f6','owner-token',$1,'markup','public','commenter')",[w.owner.id]);
   await expect(changeMembership(w.actor(w.owner),'d4E5f6',{action:'invite',usernames:['@member_bob']})).rejects.toThrow(/declined/);
  });

  it('stores the complete join lifecycle in one relation without changing a follow',async()=>{
   const w=await world();
   await link(w.bob.id,'follow',w.owner.id);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve']});
   const read=async()=> (await w.db.query("SELECT status,direction,initiated_by,accepted_at,revision,deleted_at FROM relations WHERE subject_id=$1 AND verb='join' AND object_id='a1B2c3'",[w.eve.id])).rows[0];
   expect(await read()).toMatchObject({status:'pending',direction:'invitation',initiated_by:w.owner.id,accepted_at:null,revision:1,deleted_at:null});
   await changeMembership(w.actor(w.eve),'a1B2c3',{action:'accept'});
   expect(await read()).toMatchObject({status:'accepted',revision:2,accepted_at:expect.any(String)});
   await changeMembership(w.actor(w.eve),'a1B2c3',{action:'leave'});
   expect(await read()).toMatchObject({status:'left',revision:3,deleted_at:expect.any(String)});
   expect((await w.db.query("SELECT status FROM relations WHERE subject_id=$1 AND verb='follow'",[w.bob.id])).rows).toEqual([{status:'accepted'}]);
  });

  it('does not treat pending follows as followers or autoaccept invitations',async()=>{
   const w=await world();
   await w.db.transaction(tx=>setRelationState(tx,w.bob.id,'follow',w.owner.id,{status:'pending',direction:'request',initiatedBy:w.bob.id,revision:1}));
   expect(await has(w.bob.id,'follow',w.owner.id)).toBe(false);
   expect(await count('follow',w.owner.id)).toBe(0);
   expect(await linked(w.bob.id,'follow')).toEqual([]);
   expect(await mentionCandidates(w.actor(w.owner),'a1B2c3','member_bob')).toEqual([]);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   expect((await membershipState(w.actor(w.bob),'a1B2c3')).self?.status).toBe('pending');
  });

  it('requires artifact-specific consent even after an autoaccepted invitation',async()=>{
   const w=await world();
   const eligible=()=>hasExplicitNotificationMembership(w.db,'a1B2c3',w.bob.id);
   expect(await eligible()).toBe(false);
   await link(w.bob.id,'follow',w.owner.id);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   expect(await eligible()).toBe(false);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'accept'});
   expect(await eligible()).toBe(true);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'leave'});
   expect(await eligible()).toBe(false);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_bob']});
   expect(await eligible()).toBe(false);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
   expect(await eligible()).toBe(true);
  });
  it('records self requests and explicit invitation acceptance without granting pending eligibility',async()=>{
   const w=await world();
   const eligible=(id:string)=>hasExplicitNotificationMembership(w.db,'a1B2c3',id);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'join'});
   expect(await eligible(w.owner.id)).toBe(true);
   await changeMembership(w.actor(w.bob),'a1B2c3',{action:'join'});
   expect(await eligible(w.bob.id)).toBe(false);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'approve',userId:w.bob.id});
   expect(await eligible(w.bob.id)).toBe(true);
   await changeMembership(w.actor(w.owner),'a1B2c3',{action:'invite',usernames:['@member_eve']});
   expect(await eligible(w.eve.id)).toBe(false);
   await changeMembership(w.actor(w.eve),'a1B2c3',{action:'accept'});
   expect(await eligible(w.eve.id)).toBe(true);
  });
});
