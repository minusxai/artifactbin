/**
 * Pretty URLs: /@username/<id>-<title-slug>, resolved by ID alone
 * (username and title are decoration), self-correcting to canonical via
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
    const box = await create(ownedToken, { format: 'folder', title: 'August' });
    const doc = await create(ownedToken, { title: 'Eating Healthy', markup: '<h1>x</h1>', visibility: 'public', parent_id: box.id });
    // NESTING IS NEVER IN THE ADDRESS: the canonical path is one segment, and
    // being filed under a folder does not lengthen it.
    const r = await outcome(ArtifactPage(doc.id));
    expect(r).toEqual({ kind: 'redirect', to: `/@mxmx_owner/${doc.id}-eating-healthy` });
  });

  it('/a/<id> of an anonymous doc renders in place (it IS canonical)', async () => {
    const { anonToken } = await fixtures();
    const doc = await create(anonToken, { title: 'Loose Note', markup: '<h1>x</h1>' });
    expect((await outcome(ArtifactPage(doc.id))).kind).toBe('render');
  });

  it('wrong username, stale title, an old folder path — all heal to canonical by id', async () => {
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

/*
 * The folder-LISTING cases are deleted rather than adapted: there is no listing
 * below the handle any more. A folder is an artifact with its own id-anchored
 * page, so the two questions those cases asked ("does this path render for the
 * owner", "does an empty folder 404") no longer have a subject. What survives is
 * the rule that replaced them.
 */
describe('there is no listing below the handle', () => {
  it('any trailing segment that carries no id is the uniform 404 — owner and stranger alike', async () => {
    const { ownedToken, owner } = await fixtures();
    const box = await create(ownedToken, { format: 'folder', title: 'August' });
    await create(ownedToken, { title: 'One', markup: '<h1>1</h1>', parent_id: box.id });

    expect((await outcome(UserPage(userPageProps('@mxmx_owner', ['2026', '08'])))).kind).toBe('notFound');
    // The profile ROOT is the listing (possibly empty), never a 404.
    expect((await outcome(UserPage(userPageProps('@mxmx_owner')))).kind).toBe('render');

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    // Owning the profile buys nothing here: the address named nothing.
    expect((await outcome(UserPage(userPageProps('@mxmx_owner', ['2026', '08'])))).kind).toBe('notFound');
    expect((await outcome(UserPage(userPageProps('@mxmx_owner')))).kind).toBe('render');
    // The folder itself is reached at its own address, like any document.
    expect((await outcome(UserPage(userPageProps('@mxmx_owner', [`${box.id}-august`])))).kind).toBe('render');
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
      <ListingShell authed={!!data.authed} anon={!!data.anon}>
        <ProfileListing data={data} />
      </ListingShell>
      </MemoryRouter>
    ) as ReactElement);
  };

  it('strangers see a flat list of public artifacts — private ones never appear', async () => {
    const { ownedToken } = await fixtures();
    await create(ownedToken, { title: 'Open Doc', markup: '<h1>x</h1>', visibility: 'public' });
    const box = await create(ownedToken, { format: 'folder', title: 'August' });
    const foldered = await create(ownedToken, { title: 'Foldered Doc', markup: '<h1>x</h1>', visibility: 'public', parent_id: box.id });
    await create(ownedToken, { title: 'Secret Doc', markup: '<h1>x</h1>' }); // default private
    await create(ownedToken, { title: 'Quiet Doc', markup: '<h1>x</h1>', visibility: 'unlisted' });

    const markup = await markupOf('@mxmx_owner');
    expect(markup).toContain('Open Doc');
    // Flat: a public doc inside a folder still lists on the public profile…
    expect(markup).toContain('Foldered Doc');
    // …and its link is the canonical path, which carries no folder segment.
    expect(markup).toContain(`/@mxmx_owner/${foldered.id}-foldered-doc`);
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
    expect(markup).toContain(`/a/${foldered.id}/export?format=jpg&amp;mode=card&amp;v=1&amp;r=2`);
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

  it('the owner gets the same public thumbnail cards as everyone else', async () => {
    const { ownedToken, owner } = await fixtures();
    const publicDoc = await create(ownedToken, { title: 'Open Doc', markup: '<h1>x</h1>', visibility: 'public' });
    const privateDoc = await create(ownedToken, { title: 'My Doc', markup: '<h1>x</h1>' });
    const ds = await create(ownedToken, { title: 'My Numbers', dataset: [{ a: 1 }] });
    await create(ownedToken, { title: 'Quiet Doc', markup: '<h1>x</h1>', visibility: 'unlisted' });
    sessionUser.id = owner.id;
    sessionUser.email = owner.email;

    const markup = await markupOf('@mxmx_owner');
    expect(markup).toContain(`/a/${publicDoc.id}/export?format=jpg&amp;mode=card&amp;v=1`);
    expect(markup).toContain('Open Doc');
    expect(markup).not.toContain('My Doc');
    expect(markup).not.toContain(`/a/${privateDoc.id}/export`);
    expect(markup).not.toContain('Quiet Doc');
    expect(markup).not.toContain('Open folder 2026');
    expect(markup).not.toContain('My Numbers');
    expect(markup).not.toContain(`/a/${ds.id}/export`);
    expect(markup).toContain(
      new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    );
  });
});

describe('PATCH /api/my/artifacts/:id — the metadata-only move', () => {
  it('files the row without touching content or version; the canonical URL never moves', async () => {
    const { ownedToken, owner } = await fixtures();
    const box = await create(ownedToken, { format: 'folder', title: 'August' });
    const doc = await create(ownedToken, { title: 'Eating Healthy', markup: '<h1>x</h1>', visibility: 'public' });

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const moved = await patchArtifactRoute(
      request(`/api/my/artifacts/${doc.id}`, { method: 'PATCH', json: { parent_id: box.id } }),
      params({ id: doc.id }),
    );
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ id: doc.id, parent_id: box.id, ancestor_ids: [box.id] });

    // The address is id-anchored and carries no placement, so a move changes
    // nothing about it — which is exactly why a move can be free.
    const r = await outcome(ArtifactPage(doc.id));
    expect(r).toEqual({ kind: 'redirect', to: `/@mxmx_owner/${doc.id}-eating-healthy` });

    // The retired path field is answered BY NAME, and an unreachable parent is
    // the one refusal.
    for (const [body, error] of [
      [{ folder: '2026/08' }, 'folder_retired'],
      [{ parent_id: 'zzzzzz' }, 'invalid_parent'],
      [{ parent_id: doc.id }, 'invalid_parent'],
    ] as const) {
      const bad = await patchArtifactRoute(
        request(`/api/my/artifacts/${doc.id}`, { method: 'PATCH', json: body }),
        params({ id: doc.id }),
      );
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect((await bad.json()).error).toBe(error);
    }
  });
});
