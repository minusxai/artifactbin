/** A user's sign-in email changing underneath their grants (the identity store's own write). */
/* The lattice, the link and effective roles, the SQL scopes, commenters and what an editor may do with sharing. Editors
 * through every door and artifact membership are in roles-doors.test.ts (split for the CI shards; ./roles-fixture.ts). */
import { nativeAnchor } from './native-annotation-fixture';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { describe, expect, it, beforeEach } from 'vitest';
import { useAppHarness, mintAccountToken as mintToken, setSession, request } from '@/__tests__/harness';
import { replaceArtifactFor, artifactState, type ArtifactRow, canReadArtifact, createArtifact, getArtifactById, getSharingFor, updateSharingFor } from '@/lib/artifacts';
import { effectiveRole } from '@/lib/artifact-access';
import { parseShareEntries } from '@/lib/artifact-wire';
import { linkRoleOf } from '@/lib/artifact-access';
import { ANONYMOUS_CEILING, type ArtifactRole, atLeast, canAnnotate, canEdit, canGovern, canRead, capRole, maxRole, rankOf, ROLE_ORDER, SHARE_ROLE_LABEL, SHARE_ROLES, type ShareRole, shareRolesAtLeast, type Visibility } from '@artifactbin/contracts';
import { ANONYMOUS_ACTOR, identityForUser, createUser } from '@/lib/accounts';
import { createAnnotationFor, listAnnotationsFor, actOnAnnotationFor, deleteAnnotationFor } from '@/lib/annotations';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute, POST as create } from '@/app/api/artifacts/route';
import { GET as getSharingRoute, PUT as putSharingRoute, GET as read, PUT as write } from '@/app/api/my/artifacts/[id]/sharing/route';
import { observedRequest } from '@/__tests__/conditional-request';
import { DELETE as remove, PATCH as metadata } from '@/app/api/my/artifacts/[id]/route';
import { POST as restore } from '@/app/api/my/artifacts/[id]/restore/route';
import { setUserEmail, SOURCE, account, head, docOf, clearLinkRole, shareWith, STRANGER, SHARE_ROLE_LIST } from './roles-fixture';

useAppHarness();

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
    const row = await createArtifact(token.id, token.userId, { format: 'html', source: nativeHtml(SOURCE), meta: {}, visibility: 'unlisted', title: 't' });
    return [['its token', row, identityForUser(null, token.id), 'owner'], ['another token', row, identityForUser(null, 'tok_someone_else'), 'viewer']];
  }],
  ['claimed account ownership requires resolved identity, never the creating token alone', async () => {
    const owner = await account('mxmx_test_claimed_owner@example.com');
    const privateRow = await docOf(owner, 'private');
    const publicRow = await docOf(owner, 'public');
    return [
      ['resolved owner token', privateRow, identityForUser(owner.user.id, owner.token.id), 'owner'],
      ['bare creating token, private', privateRow, identityForUser(null, owner.token.id), 'none'],
      ['bare creating token, public link', publicRow, identityForUser(null, owner.token.id), 'viewer'],
      ['other account with creating token', privateRow, identityForUser('usr_other', owner.token.id), 'none'],
    ];
  }],
  ['a named share grants exactly its role on a private document', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const out: Array<[string, ArtifactRow, Asked, ArtifactRole]> = [];
    for (const role of SHARE_ROLE_LIST) {
      const row = await docOf(owner, 'private');
      const guest = await account(`mxmx_test_${role}@example.com`);
      await shareWith(owner, row, guest.user.email!, role);
      out.push([role, row, identityForUser(guest.user.id, null), role]);
    }
    return out;
  }],
  ['a stranger gets none on a private document and viewer on a link-readable one', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = identityForUser(stranger.user.id, null, stranger.user.email);
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
    const before: [string, ArtifactRow, Asked, ArtifactRole] = ['by the session address', row, identityForUser(guest.id, null, guest.email), 'commenter'];
    expect(await effectiveRole(before[1], before[2])).toBe(before[3]);
    // Resolution stamps it, so it now follows the ACCOUNT through an address change.
    await setUserEmail(guest.id, 'mxmx_test_late_new@example.com');
    return [['by the account after an address change', row, identityForUser(guest.id, null, 'mxmx_test_late_new@example.com'), 'commenter']];
  }],
  ['an agent of an invited person reaches what its person does — no session address needed', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'private');
    const guest = await account('mxmx_test_agent_person@example.com');
    await shareWith(owner, row, guest.user.email!, 'editor');
    // A bearer token resolves to its user with NO email attached: the match has to go through users.email.
    return [['the bearer', row, identityForUser(guest.user.id, guest.token.id, null), 'editor']];
  }],
  ['an UNRESOLVED invite to an address the person no longer has grants nothing', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'private');
    const guest = await createUser({ email: 'mxmx_test_old@example.com' });
    await setUserEmail(guest.id, 'mxmx_test_new@example.com');
    await shareWith(owner, row, 'mxmx_test_old@example.com', 'editor');
    return [['the new address', row, identityForUser(guest.id, null, 'mxmx_test_new@example.com'), 'none']];
  }],
  ['the link grants a signed-in stranger exactly what it says', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = identityForUser(stranger.user.id, null, stranger.user.email);
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
      out.push([`link ${role}, nobody at all`, row, identityForUser(null, null), 'viewer']);
      // An anonymous TOKEN is not an account: attributable, but with no handle to show beside a comment.
      out.push([`link ${role}, an anonymous token`, row, identityForUser(null, anonToken.id), 'viewer']);
    }
    return out;
  }],
  ['still answers none to everyone on a private document, whatever the link column holds', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    return [['link editor, private', await docOf(owner, 'private', 'editor'), identityForUser(stranger.user.id, null, stranger.user.email), 'none']];
  }],
  ['takes the MAX of the link and a named share, in both directions', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const guest = await account('mxmx_test_guest@example.com');
    const asGuest = identityForUser(guest.user.id, null, guest.user.email);
    const linkViews = await docOf(owner, 'public', 'viewer');
    await updateSharingFor(identityForUser(owner.user.id, ''), linkViews.id, { shares: [{ email: guest.user.email!, role: 'editor' }] });
    const linkEdits = await docOf(owner, 'public', 'editor');
    await updateSharingFor(identityForUser(owner.user.id, ''), linkEdits.id, { shares: [{ email: guest.user.email!, role: 'viewer' }] });
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
        out.push([`${visibility}/${linkRole ?? 'default'}`, await docOf(owner, visibility, linkRole), identityForUser(owner.user.id, null), 'owner']);
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
    const asGuest = identityForUser(guest.user.id, null, guest.user.email);

    const priv = await docOf(owner, 'private');
    expect(await canReadArtifact(priv, identityForUser(owner.user.id, null, owner.user.email))).toBe(true);
    expect(await canReadArtifact(priv, asGuest), 'a stranger cannot read a private document').toBe(false);
    expect(await canReadArtifact(priv, ANONYMOUS_ACTOR), 'nor can an anonymous visitor').toBe(false);

    // Every share role reads a private document — including `viewer`, which the
    // old roleFor deliberately ignored while canReadArtifact honoured it.
    for (const role of SHARE_ROLE_LIST) {
      const row = await docOf(owner, 'private');
      await shareWith(owner, row, guest.user.email!, role);
      expect([role, await canReadArtifact(row, asGuest)]).toEqual([role, true]);
    }

    for (const v of ['unlisted', 'public'] as Visibility[]) {
      const row = await docOf(owner, v);
      expect([v, await canReadArtifact(row, ANONYMOUS_ACTOR)]).toEqual([v, true]);
    }
  });
});

describe('the sharing surface round-trips the link role', () => {
  it('persists it, reads it back, and reports viewer for a pre-column row', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const actor = identityForUser(owner.user.id, '');
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
      identityForUser(stranger.user.id, stranger.token.id),
      row.id,
      { anchor:nativeAnchor('root'), baseEditId: row.edit_id, body: 'a stranger with the link says something' },
      { kind: 'human', label: 'stranger', transport: 'browser' },
    );
    expect(made, JSON.stringify(made)).toMatchObject({ status: 'open' });

    // …and the owner sees it.
    const seen = await listAnnotationsFor(identityForUser(owner.user.id, owner.token.id), row.id);
    expect(seen?.length).toBe(1);
  });

  it('refuses that same stranger a comment when the link only grants a view', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const row = await docOf(owner, 'public', 'viewer');
    const made = await createAnnotationFor(
      identityForUser(stranger.user.id, stranger.token.id),
      row.id,
      { anchor:nativeAnchor('root'), baseEditId: row.edit_id, body: 'nope' },
      { kind: 'human', label: 'stranger', transport: 'browser' },
    );
    expect(made, 'the uniform miss').toBeNull();
  });

  it('lets a signed-in stranger EDIT a link-editable document, and refuses a link-commentable one', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const asStranger = identityForUser(stranger.user.id, stranger.token.id);

    const editable = await createArtifact(owner.token.id,owner.user.id,{format:'html',source:'<html><body><p>hello</p></body></html>',meta:{},title:null,description:null,visibility:'public'},{linkRole:'editor'});
    const ok = await replaceArtifactFor(asStranger,editable.id,{...editable,link_role:editable.link_role??undefined,source:editable.source!.replace('hello','edited')},{expectedVersion:editable.version,expectedState:artifactState(editable)});
    expect(ok,JSON.stringify(ok)).toMatchObject({format:'html',version:editable.version+1});
    expect((await head(editable.id))?.source).toContain('edited');

    const commentable = await createArtifact(owner.token.id,owner.user.id,{format:'html',source:'<html><body><p>hello</p></body></html>',meta:{},title:null,description:null,visibility:'public'},{linkRole:'commenter'});
    const refused=await replaceArtifactFor(asStranger,commentable.id,{...commentable,link_role:commentable.link_role??undefined,source:commentable.source!.replace('hello','nope')},{expectedVersion:commentable.version,expectedState:artifactState(commentable)});
    expect(refused, 'a commenter link is not an edit link').toBeNull();
  });

  it('lets an authenticated link editor manage sharing', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const row = await docOf(owner, 'public', 'editor');
    expect(await getSharingFor(identityForUser(stranger.user.id, stranger.token.id), row.id)).not.toBeNull();
    expect(await updateSharingFor(identityForUser(stranger.user.id, stranger.token.id), row.id, { visibility: 'private' })).not.toBeNull();
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
    const to = await mintToken('owner', owner.id);
    const commenter = await createUser({ email: 'mxmx_test_commenter@example.com' });
    const tc = await mintToken('commenter', commenter.id);
    const viewer = await createUser({ email: 'mxmx_test_viewer@example.com' });
    const tv = await mintToken('viewer', viewer.id);
    const editor = await createUser({ email: 'mxmx_test_editor@example.com' });
    const te = await mintToken('editor', editor.id);
    const res = await createArtifactRoute(jreq('/api/artifacts', 'POST', { html:nativeHtml('<div id="root" data-af-id="root"><p>hello</p></div>'), visibility: 'private' }, to.token));
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
      const input = { anchor:nativeAnchor('root'), baseEditId: w.row.edit_id, body: 'is this right?' };
      const opened = await createAnnotationFor(identityForUser(w.commenter.id, w.tc.id), w.doc.id, input, human);
      expect(opened && 'id' in opened, JSON.stringify(opened)).toBe(true);
      const id = (opened as { id: string }).id;
      const reply = await actOnAnnotationFor(identityForUser(w.commenter.id, w.tc.id), w.doc.id, id, { reply: 'still wondering' }, human);
      expect(reply && 'id' in reply).toBe(true);
      expect((await listAnnotationsFor(identityForUser(w.commenter.id, w.tc.id), w.doc.id))?.length).toBe(1);

      const head = (await getArtifactById(w.doc.id))!;
      const byEditor = await createAnnotationFor(identityForUser(w.editor.id, w.te.id), w.doc.id, { ...input, baseEditId: head.edit_id }, human);
      expect(byEditor && 'id' in byEditor, 'an editor may comment').toBe(true);

      const byViewer = await createAnnotationFor(identityForUser(w.viewer.id, w.tv.id), w.doc.id, { ...input, baseEditId: head.edit_id }, human);
      expect(byViewer, 'a viewer is refused with the uniform miss').toBeNull();
      const viewer = identityForUser(w.viewer.id, w.tv.id);
      const visible = await listAnnotationsFor(viewer, w.doc.id);
      expect(visible?.map(row => row.id).sort()).toEqual([id, (byEditor as { id: string }).id].sort());
      expect(visible?.find(row => row.id === id)?.thread.map(comment => comment.body)).toEqual(['is this right?', 'still wondering']);
      expect(await actOnAnnotationFor(viewer, w.doc.id, id, { reply: 'not permitted' }, human)).toBeNull();
      expect(await actOnAnnotationFor(viewer, w.doc.id, id, { resolve: true }, human)).toBeNull();
      expect(await deleteAnnotationFor(viewer, w.doc.id, id)).toBe(false);
      expect(await listAnnotationsFor(viewer, w.doc.id)).toEqual(visible);
      expect(await actOnAnnotationFor(identityForUser(w.commenter.id, w.tc.id), w.doc.id, id, { resolve: true }, human)).toMatchObject({ id, status: 'resolved' });
    });

    it('may NOT edit, replace, or delete — every write door is the uniform 404', async () => {
      const w = await world();
      const edit = await putArtifactRoute(jreq(`/api/artifacts/${w.doc.id}`, 'PUT', {html:nativeHtml('<div><p>changed</p></div>')}, w.tc.token), params({ id: w.doc.id }));
      expect(edit.status).toBe(404);
      const put = await putArtifactRoute(jreq(`/api/artifacts/${w.doc.id}`, 'PUT', {html:nativeHtml('<div><p>changed</p></div>')}, w.tc.token), params({ id: w.doc.id }));
      expect(put.status).toBe(404);
      expect((await getArtifactById(w.doc.id))!.version).toBe(1);
    });
  });
});

describe('what an editor may do with sharing', () => {
  const params=(id:string)=>({params:Promise.resolve({id})});
  async function person(name:string){
   const user=await createUser({email:`mxmx_test_${name}@example.com`}),token=await mintToken(name,user.id);
   return {user,token,actor:identityForUser(user.id, token.id),session:{userId:user.id,email:user.email,emailVerified:true,credential:'session' as const}};
  }
  async function fixture(role:'viewer'|'commenter'|'editor',dataset=false){
   const owner=await person('sharing_owner'),editor=await person('sharing_editor');
   const r=await create(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{...(dataset?{dataset:[{n:1}]}:{html:nativeHtml('<p>shared</p>')}),visibility:'private'}}));
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
