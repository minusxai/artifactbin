/**
 * THE PAGES' DATA, AS JSON. The app's pages render in the browser now (a Vite
 * SPA over Hono), so what the server used to compute inside a page component
 * is answered by `/api/page/*` — under the same session, the same ACL and the
 * same uniform 404s the pages had. One endpoint per page, one shape each.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as sessionPage } from '@/app/api/page/session/route';
import { GET as homePage } from '@/app/api/page/home/route';
import { GET as accountPage } from '@/app/api/page/account/route';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { GET as profilePage } from '@/app/api/page/profile/[user]/[[...path]]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { updateSharingFor } from '@/lib/artifacts';


import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const asSession = (u: { id: string; email: string }) => { sessionUser.id = u.id; sessionUser.email = u.email; };

beforeEach(async () => {
  sessionUser.id = ''; sessionUser.email = '';
});

async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_owner@example.com' }));
  const t = await mintToken('o'); await claimToken(owner.id, t.token);
  const mk = async (body: Record<string, unknown>) => (await (await createArtifactRoute(new Request(`${BASE}/api/artifacts?v=2`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify(body) }))).json()) as { id: string; edit_id: string };
  const pub = await mk({ title: 'Public one', markup: '<div><p>hello</p></div>', visibility: 'public' });
  const box = await mk({ format: 'folder', title: 'August' });
  const priv = await mk({ title: 'Secret', markup: '<div><p>secret</p></div>', visibility: 'private', parent_id: box.id });
  return { owner, t, pub, priv, box };
}

describe('GET /api/page/session', () => {
  it('names nobody, then the account with its stats', async () => {
    expect(await (await sessionPage(request('/api/page/session'))).json()).toMatchObject({ user: null, kind: 'none', stats: null });
    const w = await world();
    asSession(w.owner);
    const body = await (await sessionPage(request('/api/page/session'))).json();
    // The HANDLE travels with the account: the masthead links to `/@handle`
    // rather than printing an address nobody can click (components/HeaderBar).
    // Read here, never assigned — `ensureUsername` is a login-time write.
    expect(body.user).toEqual({ id: w.owner.id, email: w.owner.email, username: w.owner.username });
    expect(typeof body.user.username).toBe('string');
    expect(body.kind).toBe('account');
    // Three artifacts now: two documents and the folder they are filed under —
    // a folder is a row in the one table like everything else.
    expect(body.stats).toMatchObject({ total: 3, formats: { markup: 2, folder: 1 } });
  });
});

describe('GET /api/page/home', () => {
  it('is the landing for a stranger and the library for an account', async () => {
    expect(await (await homePage(request('/api/page/home'))).json()).toMatchObject({ signedIn: false });
    const w = await world();
    asSession(w.owner);
    const body = await (await homePage(request('/api/page/home'))).json();
    expect(body.signedIn).toBe(true);
    expect(body.artifacts.map((a: { id: string }) => a.id).sort()).toEqual([w.pub.id, w.priv.id, w.box.id].sort());
    expect(body.artifacts[0]).toMatchObject({ url: expect.stringMatching(/^\/a\//), format: 'markup' });
    expect(Array.isArray(body.shared)).toBe(true);
  });

  /*
   * The SHARED half of the home payload is somebody ELSE's row, so it obeys the
   * same projection rule the public profile does: placement is the owner's
   * business. `listSharedWithEmail` selects the summary columns, and
   * `ancestor_ids` joined them this phase — which would hand every invited
   * person the ids of the folders on their inviter's shelf, a place they get
   * the uniform 404 on. The viewer's OWN rows keep it: that is what draws
   * their shelf.
   */
  it('keeps another owner\'s placement out of the shared-with-you list', async () => {
    const w = await world();
    const guest = await ensureUsername(await createUser({ email: 'mxmx_test_guest@example.com' }));
    await updateSharingFor({ userId: w.owner.id, tokenId: '' }, w.priv.id, { shares: [{ email: guest.email, role: 'viewer' }] });
    asSession(guest);
    const body = await (await homePage(request('/api/page/home'))).json();
    expect(body.shared.map((a: { id: string }) => a.id)).toEqual([w.priv.id]);
    expect(body.shared[0]).not.toHaveProperty('ancestor_ids');
    expect(JSON.stringify(body.shared)).not.toContain(w.box.id);
    asSession(w.owner);
    const own = await (await homePage(request('/api/page/home'))).json();
    expect(own.artifacts[0]).toHaveProperty('ancestor_ids');
  });
});

describe('GET /api/page/account', () => {
  it('is 401 for nobody and the handle plus views for an account', async () => {
    expect((await accountPage(request('/api/page/account'))).status).toBe(401);
    const w = await world();
    asSession(w.owner);
    const body = await (await accountPage(request('/api/page/account'))).json();
    expect(body.username).toBe(w.owner.username);
    expect(body).toHaveProperty('viewsChart');
  });
});

describe('GET /api/page/artifact/:id', () => {
  it('answers the shell\'s props under the ACL, with the canonical address, the role and the session kind', async () => {
    const w = await world();
    expect((await artifactPage(request(`/api/page/artifact/${w.priv.id}`), params({ id: w.priv.id }))).status).toBe(404);
    expect((await artifactPage(request('/api/page/artifact/nope00'), params({ id: 'nope00' }))).status).toBe(404);
    const anon = await (await artifactPage(request(`/api/page/artifact/${w.pub.id}`), params({ id: w.pub.id }))).json();
    expect(anon).toMatchObject({ role: 'viewer', kind: 'none', canonical: `/@${w.owner.username}/${w.pub.id}-public-one` });
    expect(anon.surface).toMatchObject({ id: w.pub.id, editId: w.pub.edit_id, format: 'markup', title: 'Public one', version: 1 });
    expect(anon.surface).toHaveProperty('compiledCss');
    asSession(w.owner);
    const own = await (await artifactPage(request(`/api/page/artifact/${w.priv.id}`), params({ id: w.priv.id }))).json();
    expect(own).toMatchObject({ role: 'owner', kind: 'account' });
    expect(own.surface).toMatchObject({ openAnnotations: 0, accountSession: true });
  });
  it('lets the exporter\'s signed key read a private document without a session', async () => {
    const w = await world();
    const { mintExportKey } = await import('@/lib/export-key');
    const res = await artifactPage(request(`/api/page/artifact/${w.priv.id}?key=${mintExportKey(w.priv.id)}`), params({ id: w.priv.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).surface.captureKey).toBeTruthy();
  });
});

describe('GET /api/page/profile/@user/...', () => {
  it('resolves an id-anchored path to the artifact (and says when the address should heal)', async () => {
    const w = await world();
    const h = w.owner.username!;
    const exact = await (await profilePage(request(`/api/page/profile/@${h}/${w.pub.id}-public-one`), params({ user: `@${h}`, path: `${w.pub.id}-public-one` }))).json();
    expect(exact).toEqual({ kind: 'artifact', id: w.pub.id });
    const mangled = await (await profilePage(request(`/api/page/profile/@${h}/wrong/${w.pub.id}-typo`), params({ user: `@${h}`, path: `wrong/${w.pub.id}-typo` }))).json();
    expect(mangled).toEqual({ kind: 'redirect', to: `/@${h}/${w.pub.id}-public-one` });
    // an unreadable id falls through to the listing exactly like a nonexistent one — and for a
    // stranger a non-root path is the uniform 404 either way (no existence oracle)
    expect((await profilePage(request(`/api/page/profile/@${h}/${w.priv.id}-secret`), params({ user: `@${h}`, path: `${w.priv.id}-secret` }))).status).toBe(404);
    expect((await profilePage(request(`/api/page/profile/@${h}/nope00-secret`), params({ user: `@${h}`, path: 'nope00-secret' }))).status).toBe(404);
  });
  /*
   * There is no folder BRANCH here any more. A folder is an artifact with its
   * own address, so the owner's root is the rows at level 0 — the folder among
   * them, as an ordinary row — and every other segment under the handle is the
   * uniform 404, whether the viewer owns the profile or not.
   */
  /*
   * PLACEMENT IS THE OWNER'S BUSINESS. `ancestor_ids` names folders by id, and
   * a public document filed inside a private folder would hand every stranger
   * that folder's address in the profile payload — breadcrumbs to a place they
   * get the uniform 404 on, which buys the reader nothing and says something
   * about the owner's shelf. Ids are addresses rather than secrets, so this is
   * a projection rule and not a hole; the owner's own listing still carries it,
   * because the owner's listing is what draws the shelf.
   */
  it('keeps placement out of the public profile projection', async () => {
    const w = await world();
    const h = w.owner.username!;
    await createArtifactRoute(new Request(`${BASE}/api/artifacts?v=2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${w.t.token}` },
      body: JSON.stringify({ title: 'Filed', markup: '<div><p>filed</p></div>', visibility: 'public', parent_id: w.box.id }),
    }));
    const strangers = await (await profilePage(request(`/api/page/profile/@${h}`), params({ user: `@${h}` }))).json();
    expect(strangers.kind).toBe('public-profile');
    expect(strangers.files.length).toBe(2);
    for (const f of strangers.files) expect(f).not.toHaveProperty('ancestor_ids');
    expect(JSON.stringify(strangers)).not.toContain(w.box.id);
    asSession(w.owner);
    const root = await (await profilePage(request(`/api/page/profile/@${h}`), params({ user: `@${h}` }))).json();
    for (const f of root.files) expect(f).toHaveProperty('ancestor_ids');
  });

  it('lists the public index for a stranger and the ROOT for the owner; a nested path is the 404 either way', async () => {
    const w = await world();
    const h = w.owner.username!;
    const strangers = await (await profilePage(request(`/api/page/profile/@${h}`), params({ user: `@${h}` }))).json();
    expect(strangers.kind).toBe('public-profile');
    expect(strangers.files.map((f: { id: string }) => f.id)).toEqual([w.pub.id]);
    expect((await profilePage(request(`/api/page/profile/@${h}/2026/08`), params({ user: `@${h}`, path: '2026/08' }))).status).toBe(404);
    asSession(w.owner);
    const root = await (await profilePage(request(`/api/page/profile/@${h}`), params({ user: `@${h}` }))).json();
    expect(root.kind).toBe('owner-listing');
    expect(root).not.toHaveProperty('folders');
    // Level 0: the public document and the folder. The document INSIDE the
    // folder is not at the root, and is reached at its own address.
    expect(root.files.map((f: { id: string }) => f.id).sort()).toEqual([w.pub.id, w.box.id].sort());
    expect(root.files.find((f: { id: string }) => f.id === w.box.id).format).toBe('folder');
    expect((await profilePage(request(`/api/page/profile/@${h}/2026/08`), params({ user: `@${h}`, path: '2026/08' }))).status).toBe(404);
    expect((await profilePage(request('/api/page/profile/nobody'), params({ user: 'nobody' }))).status).toBe(404);
  });
});
