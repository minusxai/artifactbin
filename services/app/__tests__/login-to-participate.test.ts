/**
 * THE WAY IN — a guest holding a link that grants more than they can use.
 *
 * ANONYMOUS_CEILING caps the link at `viewer` because every write here is
 * attributed and a guest has nothing to attribute one to. That is the right
 * refusal, but on its own it is a SILENT one: the owner set the link to
 * `can comment`, handed it over, and the person holding it sees a document
 * that says nothing about the invitation it carries.
 *
 * So the document names what the link grants and offers the door — an ordinary
 * link to /login and back. It is a DOOR, never a capability: nothing here
 * widens the ACL, and the answer to "may this person comment" is unchanged
 * until they have an account for effectiveRole to find.
 *
 * Three properties this file exists to hold:
 *   - it appears only where signing in would actually CHANGE something;
 *   - it costs a guest nothing — static markup in the reader chrome already
 *     being sent, so the direct-document fast path (server/app
 *     servesDocumentDirectly) survives untouched;
 *   - it never appears on a capture, which /export photographs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness } from './harness';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createArtifact, updateSharingFor, type ArtifactRow, type Visibility } from '@/lib/artifacts';
import { buildStoryDocument } from '@/lib/story/document';
import { roleBehindLogin, type ShareRole } from '@/lib/share-roles';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const sessionUser: { id: string; email: string } = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));

const BASE = 'http://localhost:3000';
const SOURCE = '<div><p>hello</p></div>';
const harness = useAppHarness();

beforeEach(() => {
  sessionUser.id = '';
  sessionUser.email = '';
});

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
  if (linkRole) await updateSharingFor({ tokenId: '', userId: owner.user.id }, row.id, { linkRole });
  const db = await harness.db();
  return (await db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id = $1', [row.id])).rows[0];
}

const serve = async (id: string, query = ''): Promise<string> => {
  const res = await rawRoute(new Request(`${BASE}/a/${id}/raw${query}`), { params: Promise.resolve({ id }) });
  return res.text();
};

/** The control's stable marker — the chrome around it is free to change. */
const SIGN_IN = 'data-mx-signin';

describe('roleBehindLogin — the exact inverse of the anonymous ceiling', () => {
  it('names what an account would unlock, and none when it would unlock nothing', () => {
    expect(roleBehindLogin('editor')).toBe('editor');
    expect(roleBehindLogin('commenter')).toBe('commenter');
    // At or under the ceiling there is nothing behind the door: a guest already
    // reads this document, so offering them a login would be chrome with no
    // consequence on every public link in the product.
    expect(roleBehindLogin('viewer')).toBe('none');
    expect(roleBehindLogin('none'), 'a private link grants nothing to unlock').toBe('none');
  });
});

describe('the served document offers a guest the door', () => {
  it('says what the link grants — comment and edit each named', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    for (const [role, label] of [['commenter', 'log in to comment'], ['editor', 'log in to edit']] as const) {
      const row = await docOf(owner, 'public', role);
      const html = await serve(row.id);
      expect([role, html.includes(SIGN_IN)]).toEqual([role, true]);
      expect(html).toContain(label);
      // Back to the document afterwards, or the invitation ends on the home
      // page and the person has to find their way back to what they were sent.
      expect(html).toContain(`href="/login?callbackUrl=%2Fa%2F${row.id}"`);
    }
  });

  it('stays silent when signing in would change nothing', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    expect(await serve((await docOf(owner, 'public', 'viewer')).id)).not.toContain(SIGN_IN);
    expect(await serve((await docOf(owner, 'unlisted', 'viewer')).id)).not.toContain(SIGN_IN);
    // The pre-column shape, which reads as `viewer` — every document published
    // before general access existed must look exactly as it did.
    expect(await serve((await docOf(owner, 'public')).id)).not.toContain(SIGN_IN);
  });

  it('does not offer it to someone who already has the role', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const stranger = await account('mxmx_test_stranger@example.com');
    const row = await docOf(owner, 'public', 'editor');
    sessionUser.id = stranger.user.id;
    sessionUser.email = stranger.user.email!;
    expect(await serve(row.id), 'an account is what the ceiling was withholding').not.toContain(SIGN_IN);
  });

  it('never appears on a capture — /export photographs that frame', async () => {
    const owner = await account('mxmx_test_owner@example.com');
    const row = await docOf(owner, 'public', 'editor');
    expect(await serve(row.id, '?chrome=0')).not.toContain(SIGN_IN);
  });
});

describe('the door itself', () => {
  const build = (over: Parameters<typeof buildStoryDocument>[0]) => buildStoryDocument(over);

  it('cannot be broken out of by the return address', async () => {
    const html = await build({
      source: SOURCE,
      compiledCss: null,
      theme: null,
      colorMode: null,
      refData: {},
      title: null,
      signIn: { unlocks: 'editor', callbackUrl: '/a/x"><script>alert(1)</script>' },
    });
    // It goes into a URL position, so percent-encoding is the defense that
    // fits it — the quote that would close the attribute never survives as
    // one, and escapeHtml is the belt behind it for anything that did.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('callbackUrl=%2Fa%2Fx%22%3E%3Cscript%3E');
  });

  it('leaves the document itself alone — no runtime bought, no fetch added', async () => {
    const plain = { source: SOURCE, compiledCss: null, theme: null, colorMode: null, refData: {}, title: null };
    const withDoor = await build({ ...plain, signIn: { unlocks: 'commenter', callbackUrl: '/a/abc123' } });
    // A document of prose ships no runtime; being invited to comment on it is
    // not a reason to download one. The door is an anchor, nothing more.
    expect(withDoor).not.toContain('type="module"');
    expect(withDoor).toMatch(new RegExp(`<a[^>]*${SIGN_IN}[^>]*target="_top"`));
  });
});
