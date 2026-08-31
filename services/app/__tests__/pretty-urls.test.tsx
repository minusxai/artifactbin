/**
 * Pretty URLs: /@username/folder/.../<id>-<title-slug>, resolved by ID alone
 * (username/folders/title are decoration), self-correcting to canonical via
 * redirect. /a/<id> stays the universal short form: canonical for anonymous
 * docs, a redirect for owned ones. The ACL runs BEFORE any redirect, so a
 * probe never learns the owner's username from a private doc.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';

import { artifactPage as ArtifactPage } from '@/test/helpers/pages';
import { GET as profileData } from '@/app/api/page/profile/[user]/[[...path]]/route';
import { ListingShell } from '@/components/Listing';
import { ProfileListing } from '@/web/pages/Profile';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PATCH as patchArtifactRoute } from '@/app/api/my/artifacts/[id]/route';
import { mintExportKey } from '@/lib/export-key';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername, setUsername } from '@/lib/users';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();

const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const shortPageProps = (id: string, key?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(key ? { key } : {}),
});
/**
 * The pretty URL's RESOLUTION is now an endpoint (/api/page/profile): the same
 * three outcomes the page used to express as Next control flow — render the
 * document, heal the address, or the uniform 404 — come back as JSON. `UserPage`
 * asks it and reports them in the old vocabulary, so every case below reads as
 * it did.
 */
const UserPage = async ({ user, path }: { user: string; path?: string[] }): Promise<{ kind: 'render' | 'redirect' | 'notFound'; to?: string }> => {
  const p = (path ?? []).join('/');
  const res = await profileData(new Request(`http://localhost:3000/api/page/profile/${user}${p ? '/' + p : ''}`), { params: Promise.resolve({ user, ...(p ? { path: p } : {}) }) });
  if (res.status === 404) return { kind: 'notFound' };
  const body = await res.json();
  if (body.kind === 'redirect') return { kind: 'redirect', to: body.to };
  return { kind: 'render' };
};
const userPageProps = (user: string, path?: string[]) => ({ user, path });

/** Runs a page and reports what Next control-flow it threw, if any. */
/** `/a/<id>` is still a Next page for now; the profile helper above answers directly. */
async function outcome(p: Promise<unknown>): Promise<{ kind: 'render' | 'redirect' | 'notFound'; to?: string }> {
  try {
    const value = await p;
    if (value && typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) return value as { kind: 'render' | 'redirect' | 'notFound'; to?: string };
    return { kind: 'render' };
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? '');
    if (digest.startsWith('NEXT_REDIRECT')) return { kind: 'redirect', to: digest.split(';')[2] };
    if (digest.includes('NOT_FOUND') || digest.includes('404')) return { kind: 'notFound' };
    throw error;
  }
}

async function fixtures() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_owner@example.com' }));
  await setUsername(owner.id, 'mxmx_owner');
  const t = await mintToken('owned');
  await claimToken(owner.id, t.token);
  const anon = await mintToken('anon');
  return { owner, ownedToken: t.token, anonToken: anon.token };
}

async function create(token: string, body: Record<string, unknown>) {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string }>;
}

beforeEach(() => {
  sessionUser.id = '';
  sessionUser.email = '';
});

describe('canonical redirects', () => {
  it('/a/<id> of an owned public doc redirects to /@username/<id>-<title-slug>', async () => {
    const { ownedToken } = await fixtures();
    const doc = await create(ownedToken, { title: 'Eating Healthy', markup: '<h1>x</h1>', visibility: 'public', folder: '2026/08' });
    const r = await outcome(ArtifactPage(doc.id));
    expect(r).toEqual({ kind: 'redirect', to: `/@mxmx_owner/2026/08/${doc.id}-eating-healthy` });
  });

  it('/a/<id> of an anonymous doc renders in place (it IS canonical)', async () => {
    const { anonToken } = await fixtures();
    const doc = await create(anonToken, { title: 'Loose Note', markup: '<h1>x</h1>' });
    expect((await outcome(ArtifactPage(doc.id))).kind).toBe('render');
  });

  it('wrong username, stale title, wrong folder — all heal to canonical by id', async () => {
    const { ownedToken } = await fixtures();
    const doc = await create(ownedToken, { title: 'Eating Healthy', markup: '<h1>x</h1>', visibility: 'public' });
    const canonical = `/@mxmx_owner/${doc.id}-eating-healthy`;
    for (const [user, path] of [
      ['@wronguser', [`${doc.id}-eating-healthy`]],
      ['@mxmx_owner', [`${doc.id}-stale-title`]],
      ['@mxmx_owner', ['old', 'folder', doc.id]],
    ] as const) {
      const r = await outcome(UserPage(userPageProps(user, [...path])));
      expect(r).toEqual({ kind: 'redirect', to: canonical });
    }
  });

  it('the canonical URL itself renders, no redirect loop', async () => {
    const { ownedToken } = await fixtures();
    const doc = await create(ownedToken, { title: 'Eating Healthy', markup: '<h1>x</h1>', visibility: 'public' });
    expect((await outcome(UserPage(userPageProps('@mxmx_owner', [`${doc.id}-eating-healthy`])))).kind).toBe('render');
  });

  it('a non-@ first segment is a plain 404 (the catch-all must not swallow typo routes)', async () => {
    expect((await outcome(UserPage(userPageProps('randomword', ['x'])))).kind).toBe('notFound');
  });
});

describe('privacy through the resolver', () => {
  it('a private doc 404s (never redirects) for strangers — the redirect would leak the owner', async () => {
    const { ownedToken, owner } = await fixtures();
    const doc = await create(ownedToken, { title: 'Secret Plan', markup: '<h1>x</h1>' }); // default private
    expect((await outcome(ArtifactPage(doc.id))).kind).toBe('notFound');
    expect((await outcome(UserPage(userPageProps('@mxmx_owner', [doc.id])))).kind).toBe('notFound');

    // The owner gets the normal redirect + render.
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const r = await outcome(ArtifactPage(doc.id));
    expect(r).toEqual({ kind: 'redirect', to: `/@mxmx_owner/${doc.id}-secret-plan` });
  });

  it('the exporter\'s signed key opens the page in place (no session, no redirect)', async () => {
    const { ownedToken } = await fixtures();
    const doc = await create(ownedToken, { title: 'Secret Plan', markup: '<section><p>hello</p></section>' });
    // A minted key renders WITHOUT canonicalizing: the exporter is a machine
    // fetch, and the key must never reach a human-facing location bar.
    expect((await outcome(ArtifactPage(doc.id, { key: mintExportKey(doc.id) }))).kind).toBe('render');
    // edit_id is reader-visible, so it must buy nothing here (see acl-holes).
    const db = await harness.db();
    const editId = (await db.query<{ edit_id: string }>('SELECT edit_id FROM artifacts WHERE id = $1', [doc.id])).rows[0].edit_id;
    expect((await outcome(ArtifactPage(doc.id, { key: editId }))).kind).toBe('notFound');
  });
});

describe('folder listings (owner-only)', () => {
  it('folders render for the owner and 404 for strangers; the root renders for both', async () => {
    const { ownedToken, owner } = await fixtures();
    await create(ownedToken, { title: 'One', markup: '<h1>1</h1>', folder: '2026/08' });

    // Folders are the owner's organization — never part of the public surface.
    expect((await outcome(UserPage(userPageProps('@mxmx_owner', ['2026', '08'])))).kind).toBe('notFound');
    // The profile ROOT is the public listing (possibly empty), not a 404.
    expect((await outcome(UserPage(userPageProps('@mxmx_owner')))).kind).toBe('render');

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    expect((await outcome(UserPage(userPageProps('@mxmx_owner', ['2026', '08'])))).kind).toBe('render');
    expect((await outcome(UserPage(userPageProps('@mxmx_owner')))).kind).toBe('render');
  });

  /**
   * A folder EXISTS only through the artifacts that carry it (`folder` is a
   * materialized path, nothing more), so an address naming one that holds
   * nothing — no files, no child folders — names nothing, and answers the
   * same 404 every other miss does. It used to render an empty listing, a
   * third face for "not found". The ROOT is the one empty listing that is a
   * real page: a brand-new account's dashboard.
   */
  it('a folder that holds nothing is a 404, even for the owner — the root never is', async () => {
    const { ownedToken, owner } = await fixtures();
    await create(ownedToken, { title: 'One', markup: '<h1>1</h1>', folder: '2026/08' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    expect((await outcome(UserPage(userPageProps('@mxmx_owner', ['gogo'])))).kind).toBe('notFound');
    // An ancestor exists through its child; the empty root stays a page.
    expect((await outcome(UserPage(userPageProps('@mxmx_owner', ['2026'])))).kind).toBe('render');
    expect((await outcome(UserPage(userPageProps('@mxmx_owner')))).kind).toBe('render');
  });
});

describe('public profile listing', () => {
  /**
   * The profile page renders in the BROWSER now from /api/page/profile, so the
   * listing is asserted the way it is built: the endpoint's data through the
   * same components the SPA mounts (components/Listing).
   */
  const markupOf = async (user: string, path?: string[]) => {
    const p = (path ?? []).join('/');
    const res = await profileData(new Request(`http://localhost:3000/api/page/profile/${user}${p ? '/' + p : ''}`), { params: Promise.resolve({ user, ...(p ? { path: p } : {}) }) });
    if (!res.ok) return '';
    const data = await res.json();
    if (data.kind === 'redirect' || data.kind === 'artifact') return JSON.stringify(data);
    // The SAME pieces web/pages/Profile renders — `ProfileShelf` especially,
    // which is where `assets={false}` lives. Re-composing them by hand here is
    // what let this test drift from the page it claims to describe.
    // The page menu reads the current path, so the tree is rendered inside a router.
    return renderToStaticMarkup((
      <MemoryRouter initialEntries={[`/${user}${p ? '/' + p : ''}`]}>
      <ListingShell email={data.email} stats={data.stats ?? null} authed={data.kind === 'owner-listing' || !!data.authed} anon={!!data.anon}>
        <ProfileListing data={data} />
      </ListingShell>
      </MemoryRouter>
    ) as ReactElement);
  };

  it('strangers see a flat list of public artifacts — private ones never appear', async () => {
    const { ownedToken } = await fixtures();
    await create(ownedToken, { title: 'Open Doc', markup: '<h1>x</h1>', visibility: 'public' });
    const foldered = await create(ownedToken, { title: 'Foldered Doc', markup: '<h1>x</h1>', visibility: 'public', folder: '2026/08' });
    await create(ownedToken, { title: 'Secret Doc', markup: '<h1>x</h1>' }); // default private
    await create(ownedToken, { title: 'Quiet Doc', markup: '<h1>x</h1>', visibility: 'unlisted' });

    const markup = await markupOf('@mxmx_owner');
    expect(markup).toContain('Open Doc');
    // Flat: a public doc inside a folder still lists at the root…
    expect(markup).toContain('Foldered Doc');
    // …and its link is the canonical path, folder included.
    expect(markup).toContain(`/@mxmx_owner/2026/08/${foldered.id}-foldered-doc`);
    expect(markup).not.toContain('Secret Doc');
    // Unlisted reads like public but never lists — that's its whole meaning.
    expect(markup).not.toContain('Quiet Doc');
    // Blog-style absolute publish dates only — never relative times, which
    // narrate the owner's activity ("5 mins ago" says they're at their desk).
    expect(markup).not.toContain('just now');
    expect(markup).toContain(
      new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    );
    // The id is an address, not row chrome: it lives in the href only.
    expect(markup).not.toContain(`>${foldered.id}<`);
    // Each card carries the version-busted og-card export as its thumbnail,
    // over a quiet spinner (a steady spin, never a blink) that shows while
    // the shot renders server-side.
    expect(markup).toContain(`/a/${foldered.id}/export?format=jpg&amp;mode=card&amp;v=1`);
    expect(markup).toContain('animate-spin');
    expect(markup).not.toContain('animate-pulse');
  });

  it('supporting files never list — the profile is documents, not storage', async () => {
    // Datasets and images are the material documents are BUILT from (bound as
    // ref:<id>); public visibility keeps them link-reachable for the documents
    // that embed them, but a profile that lists them reads as a junk drawer.
    const { ownedToken } = await fixtures();
    await create(ownedToken, { title: 'The Report', markup: '<h1>x</h1>', visibility: 'public' });
    await create(ownedToken, { title: 'Raw Numbers', dataset: [{ region: 'EU', revenue: 10 }], visibility: 'public' });
    await create(ownedToken, {
      title: 'Chart Png',
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      visibility: 'public',
    });

    const markup = await markupOf('@mxmx_owner');
    expect(markup).toContain('The Report');
    expect(markup).not.toContain('Raw Numbers');
    expect(markup).not.toContain('Chart Png');
  });

  it('a signed-in non-owner gets the same public view as a stranger', async () => {
    const { ownedToken } = await fixtures();
    await create(ownedToken, { title: 'Open Doc', markup: '<h1>x</h1>', visibility: 'public' });
    await create(ownedToken, { title: 'Secret Doc', markup: '<h1>x</h1>' });
    const other = await ensureUsername(await createUser({ email: 'other@minusx.ai' }));
    sessionUser.id = other.id;
    sessionUser.email = other.email;

    const markup = await markupOf('@mxmx_owner');
    expect(markup).toContain('Open Doc');
    expect(markup).not.toContain('Secret Doc');
  });

  it('an all-private profile renders empty rather than 404 (the root is not an oracle)', async () => {
    const { ownedToken } = await fixtures();
    await create(ownedToken, { title: 'Secret Doc', markup: '<h1>x</h1>' });
    const markup = await markupOf('@mxmx_owner');
    expect(markup).not.toContain('Secret Doc');
    expect(markup).toContain('nothing here yet');
  });

  it('a nonexistent handle still 404s', async () => {
    await fixtures();
    expect((await outcome(UserPage(userPageProps('@nobody_here')))).kind).toBe('notFound');
  });

  it('the OWNER gets the same thumbnail cards — plus what only owners need', async () => {
    // One profile, one look: the card grid is the view for everyone. The owner
    // additionally sees visibility per card, private documents and folders.
    // Data files are the dashboard's business, not the profile's.
    const { ownedToken, owner } = await fixtures();
    const doc = await create(ownedToken, { title: 'My Doc', markup: '<h1>x</h1>' }); // default private
    const ds = await create(ownedToken, { title: 'My Numbers', dataset: [{ a: 1 }] });
    await create(ownedToken, { title: 'Foldered', markup: '<h1>x</h1>', folder: '2026/08' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;

    const markup = await markupOf('@mxmx_owner');
    // Documents render as thumbnail cards — private ones included (the img
    // request carries the owner session, so the export ACL admits it).
    expect(markup).toContain(`/a/${doc.id}/export?format=jpg&amp;mode=card&amp;v=1`);
    expect(markup).toContain('My Doc');
    expect(markup).toContain('private');
    // Folders survive as navigation.
    expect(markup).toContain('Open folder 2026');
    // Data files are NOT listed here any more. They are the material documents
    // are built from, and a profile listing them is the junk drawer
    // listPublicArtifactsByUser already refuses to be — so the owner's own
    // profile gets the same treatment and manages material on the dashboard,
    // which is the one page with a delete affordance for it.
    expect(markup).not.toContain('My Numbers');
    expect(markup).not.toContain(`/a/${ds.id}/export`);
    // Navigation lives behind the page-mounted hamburger, so what server-
    // renders is the button, not the links.
    expect(markup).toContain('aria-label="Open menu"');
  });

  it('the owner keeps the full view: private docs, folders, and dates', async () => {
    const { ownedToken, owner } = await fixtures();
    await create(ownedToken, { title: 'Secret Doc', markup: '<h1>x</h1>', folder: '2026/08' });
    await create(ownedToken, { title: 'Root Doc', markup: '<h1>x</h1>' });
    await create(ownedToken, { title: 'Quiet Doc', markup: '<h1>x</h1>', visibility: 'unlisted' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const markup = await markupOf('@mxmx_owner');
    expect(markup).toContain('2026/');
    expect(markup).toContain('Root Doc');
    expect(markup).toContain('Quiet Doc'); // unlisted hides from strangers, never from the owner
    // Cards carry the same absolute date stamp the public shelf shows.
    expect(markup).toContain(
      new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    );
  });
});

describe('PATCH /api/my/artifacts/:id — metadata-only folder move', () => {
  it('moves the file without touching content or version; canonical follows', async () => {
    const { ownedToken, owner } = await fixtures();
    const doc = await create(ownedToken, { title: 'Eating Healthy', markup: '<h1>x</h1>', visibility: 'public' });

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const moved = await patchArtifactRoute(
      request(`/api/my/artifacts/${doc.id}`, { method: 'PATCH', json: { folder: '2026/08' } }),
      params({ id: doc.id }),
    );
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ id: doc.id, folder: '2026/08' });

    const r = await outcome(ArtifactPage(doc.id));
    expect(r).toEqual({ kind: 'redirect', to: `/@mxmx_owner/2026/08/${doc.id}-eating-healthy` });

    const bad = await patchArtifactRoute(
      request(`/api/my/artifacts/${doc.id}`, { method: 'PATCH', json: { folder: 'has space' } }),
      params({ id: doc.id }),
    );
    expect(bad.status).toBe(400);
  });
});
