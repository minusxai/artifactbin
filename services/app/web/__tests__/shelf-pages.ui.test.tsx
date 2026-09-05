/**
 * THE SHELF PAGES: ONE COLUMN, AND WHAT EACH ONE LEADS WITH.
 *
 * Ported from master's `page-column`, `dashboard-shape` and `profile-shelf`
 * tests, which rendered the Next pages this branch replaced. The RULES are
 * master's and unchanged — only the thing being rendered moved:
 *
 *  - The dashboard and a profile are the same shelf, so they must be the same
 *    WIDTH, and the masthead above them must span that same column. A literal
 *    that drifts back into one of these pages is exactly the failure, so this
 *    is asserted through the rendered pages rather than by reading the shared
 *    constant.
 *  - The dashboard always leads with the compact connect-agent door. Owned
 *    and shared shelves follow it; account utilities never become dashboard
 *    furniture just because the owned shelf is empty.
 *  - A profile renders the same shelf with its capabilities withheld.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import HeaderBar from '@/components/HeaderBar';
import { renderToStaticMarkup } from 'react-dom/server';
import { REFRESH_EVENT } from '@/lib/navigation';
import { router as routerDouble, resetRouter } from '@/test/setup/router';
import { HomePage } from '@/web/pages/Home';
import { ProfilePage } from '@/web/pages/Profile';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_c', email: 'c@x.io' } } }) }));

const doc = (id: string) => ({
  id, url: `/a/${id}`, title: `Doc ${id}`, description: null, format: 'markup', version: 1,
  visibility: 'public', parent_id: null, ancestor_ids: [], updated_at: '2026-08-20T00:00:00.000Z', views: 0, sparkline: null,
});

let home: unknown;
let profile: unknown;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/page/home')) return new Response(JSON.stringify(home), { status: 200 });
    if (String(url).includes('/api/page/profile')) return new Response(JSON.stringify(profile), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The `max-w-*` the page's own <main> carries. */
const mainWidth = (el: HTMLElement): string | undefined =>
  el.querySelector('main')?.className.match(/max-w-\S+/)?.[0];

describe('the shelf pages share one column', () => {
  it('the dashboard and the profile are exactly as wide as each other', async () => {
    home = { signedIn: true, artifacts: [doc('a'), doc('b')], shared: [] };
    profile = { kind: 'owner-listing', handle: 'cee', files: [doc('a')], total: 1, stats: { total: 1, formats: { markup: 1 } }, email: 'c@x.io' };

    const dash = render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(mainWidth(dash.container)).toBeDefined());
    const dashWidth = mainWidth(dash.container);
    cleanup();

    const prof = render(<MemoryRouter initialEntries={['/@cee']}><Routes><Route path="/:user/*" element={<ProfilePage />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(mainWidth(prof.container)).toBeDefined());
    expect(mainWidth(prof.container)).toBe(dashWidth);
  });

  it('and the masthead spans the same column it heads', async () => {
    home = { signedIn: true, artifacts: [doc('a')], shared: [] };
    const dash = render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(mainWidth(dash.container)).toBeDefined());
    const masthead = renderToStaticMarkup(HeaderBar({ email: 'c@x.io', stats: null }) as React.ReactElement);
    expect(masthead).toContain(mainWidth(dash.container)!);
  });
});

describe('what the dashboard leads with', () => {
  // The signed-out door used to BE a login form. A stranger arriving from a
  // shared link has nothing to log into yet, so the landing proves the
  // product first and leaves the login to the masthead.
  it('SIGNED OUT: shows the landing, not a login form and not the token browser', async () => {
    home = { signedIn: false };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Get started')).toBeInTheDocument());
    expect(screen.getByLabelText('What you can use it for')).toBeInTheDocument();
    expect(screen.queryByLabelText('Log in with email')).toBeNull();
    expect(screen.queryByLabelText('Browse artifacts by agent token')).toBeNull();
  });

  // ONE DOOR, ONE NAME, EVERY SURFACE. The dashboard used to fold the same
  // panel into a strip of its own called "connect an agent" while the landing
  // showed it open and called it "getting started" — one thing wearing two
  // names, and the reader had to open the strip to find out they were the
  // same. There is one presentation now, so these assertions are about the
  // landing's panel appearing on a signed-in page.
  it('WITH artifacts: the getting-started panel and the shelf, not the teaching rail', async () => {
    home = { signedIn: true, artifacts: [doc('a')], shared: [] };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    expect(screen.getByLabelText('Get started')).toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toContain('connect an agent');
    // Examples are for a page with nothing of the reader's own on it.
    expect(screen.queryByLabelText('What you can use it for')).toBeNull();
    // The once-ever utilities are not permanent furniture.
    expect(screen.queryByText(/claim an agent's artifacts/i)).toBeNull();
  });

  it('offers ONE way to the trash, and only to an account', async () => {
    /*
     * P3 made delete a trash: a deleted row is recoverable for ever, which
     * is worth nothing if there is no way to reach it. One link in the
     * dashboard's chrome, and nothing else — an anonymous browser has no
     * account to hold a trash, so it is not offered one.
     */
    home = { signedIn: true, artifacts: [doc('a')], shared: [] };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    expect(screen.getByLabelText('Trash')).toHaveAttribute('href', '/trash');
    cleanup();
    home = { signedIn: false };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Get started')).toBeInTheDocument());
    expect(screen.queryByLabelText('Trash')).toBeNull();
  });

  it('EMPTY: names the first artifact, then the panel, then other people\u2019s work', async () => {
    home = { signedIn: true, artifacts: [], shared: [] };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    // Greeted by name, from the session the page chrome already reads — the
    // accessible name IS the visible line, so this matches its stable half.
    const heading = await screen.findByLabelText(/create your first artifact/i);
    expect(heading).toHaveTextContent("hi c, let\u2019s create your first artifact!");
    const panel = screen.getByLabelText('Get started');
    const examples = screen.getByLabelText('What you can use it for');
    // Its own name here, and the documents WITHOUT the landing's wheel of
    // use-phrases: this reader has already bought the pitch.
    expect(examples).toHaveTextContent('Inspiration Zone');
    expect(examples.querySelector('[data-use-row]')).toBeNull();
    // The SAME door, open, with both paths on the page: an empty library must
    // not be a page whose only content is a closed strip.
    expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
    expect(screen.getByLabelText('Install for my agent')).toBeInTheDocument();
    expect(heading.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.compareDocumentPosition(examples) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('WITHOUT owned artifacts: the panel still leads shared work and account utilities stay away', async () => {
    home = {
      signedIn: true,
      artifacts: [],
      shared: [{ ...doc('shared'), description: null, role: 'viewer', owner_username: 'alice' }],
    };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const connect = await screen.findByLabelText('Get started');
    const shared = await screen.findByLabelText('Open shared artifact shared');
    expect(connect.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Work shared WITH someone is still a library, so it is not the empty page.
    expect(screen.queryByLabelText('Create your first artifact')).toBeNull();
    expect(screen.queryByLabelText('Claim a token')).toBeNull();
    expect(screen.queryByLabelText('Add data')).toBeNull();
  });
});

/**
 * CLAIMING TURNS AN EMPTY LIBRARY INTO A FULL ONE, AND THE ANSWER MUST SURVIVE
 * THE TURN.
 *
 * The dashboard renders one subtree for an empty library and another for a
 * full one. `ClaimBanner` holds its outcome — "Added 1 to your account." — in
 * its OWN state, and claiming ends in `router.refresh()`, which re-reads the
 * page the banner is standing on. Put the banner inside BOTH arms of that
 * branch and React REMOUNTS it on that refresh: fresh state, no result, and
 * the report vanishes in the frame it was earned. So the pieces that carry
 * state hold ONE slot across the flip.
 *
 * The banner's own test cannot see this — it renders the component alone. It
 * takes the PAGE, with a library that fills up underneath it. The ui project
 * stubs `useRouter` (test/setup/router), so the refresh the banner asks for is
 * COUNTED there and delivered here the way the real one delivers it: the app's
 * own `REFRESH_EVENT`, which is not stubbed. `scripts/gate-claim-flow.mjs` is
 * the browser half of the same rule, end to end.
 */
describe('claiming across the empty \u2192 full flip', () => {
  it('still reports what it added once the refresh fills the library', async () => {
    resetRouter();
    home = { signedIn: true, artifacts: [], shared: [] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/page/home')) return new Response(JSON.stringify(home), { status: 200 });
      if (u.includes('/api/tokens/claimable')) {
        return new Response(JSON.stringify({ claimable: [{ tokenId: 'tok_1', titles: ['Quarterly Review'], artifacts: 1 }] }), { status: 200 });
      }
      if (u.includes('/api/tokens/claim')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    // The offer lands on the empty library: nothing published yet, and drafts
    // this browser made before signing in.
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await screen.findByLabelText(/create your first artifact/i);
    await screen.findByLabelText('Unclaimed drafts');

    fireEvent.click(screen.getByLabelText('Add to my account'));
    await waitFor(() => expect(routerDouble.refreshed).toBe(1));
    expect(screen.getByLabelText('Claim result')).toHaveTextContent(/Added/);

    // The refresh the banner just asked for, with what claiming did to the
    // library: it is no longer empty.
    home = { signedIn: true, artifacts: [doc('a')], shared: [] };
    await act(async () => { window.dispatchEvent(new Event(REFRESH_EVENT)); });

    // The page really did flip — without this the rule below could pass on a
    // page that never changed shape, which is not the case under test.
    await screen.findByText('Doc a');
    expect(screen.queryByLabelText(/create your first artifact/i)).toBeNull();

    // THE RULE: the flip does not take the answer with it.
    expect(screen.getByLabelText('Claim result')).toHaveTextContent(/Added/);
  });
});

const atProfile = () =>
  render(<MemoryRouter initialEntries={['/@cee']}><Routes><Route path="/:user/*" element={<ProfilePage />} /></Routes></MemoryRouter>);

describe('a profile', () => {
  it('renders the shelf for the files it lists', async () => {
    profile = { kind: 'owner-listing', handle: 'cee', files: [doc('a'), doc('b')], total: 2, stats: { total: 2, formats: { markup: 2 } }, email: 'c@x.io' };
    // Mounted under the app's own route: ProfilePage reads `:user` from it,
    // and a bare mount reads nothing — which the typo guard answers with 404.
    atProfile();
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    expect(screen.getByText('Doc b')).toBeInTheDocument();
  });

  /*
   * MAKING A FOLDER IS THE OWNER'S VERB EVERYWHERE THEY OWN THINGS.
   *
   * The owner's own profile root IS the dashboard's shelf under a different
   * question — same rows, same account, same root — and it shipped without the
   * one control that puts something new on it, because `New folder` was tied to
   * `actions === 'full'` and a profile withholds the row verbs on purpose (a
   * page whose point is handing someone a link should not edit or delete). So
   * the capability is its own prop rather than a promotion: creating is not an
   * action on any row.
   *
   * A stranger's profile never shows it, and that is the same rule from the
   * other side — it is granted, never inherited.
   */
  it('offers the owner New folder beside the shelf, and a stranger nothing', async () => {
    profile = { kind: 'owner-listing', handle: 'cee', files: [doc('a')], total: 1, stats: { total: 1, formats: { markup: 1 } }, email: 'c@x.io' };
    atProfile();
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    expect(screen.getByLabelText('New folder')).toBeInTheDocument();
    // …and the row verbs stay withheld: this is a create control, not `full`.
    expect(screen.queryByLabelText('Edit Doc a')).toBeNull();
    cleanup();

    profile = { kind: 'public-profile', handle: 'cee', owner: { id: 'usr_c' }, follow: { following: false, count: 0 }, files: [doc('a')], email: null, authed: false, anon: false };
    atProfile();
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    expect(screen.queryByLabelText('New folder')).toBeNull();
  });

  /** A folder made here lands at the account ROOT, which is what this page lists. */
  it('files a folder made from the profile at the root', async () => {
    profile = { kind: 'owner-listing', handle: 'cee', files: [doc('a')], total: 1, stats: { total: 1, formats: { markup: 1 } }, email: 'c@x.io' };
    atProfile();
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('New folder'));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Reports' } });
    fireEvent.keyDown(screen.getByLabelText('Folder name'), { key: 'Enter' });
    await waitFor(() => {
      const call = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
        .find(([url]) => String(url) === '/api/my/artifacts');
      expect(call, 'the profile never asked to create a folder').toBeTruthy();
      expect(JSON.parse(String(call![1].body))).toEqual({ format: 'folder', title: 'Reports', parent_id: null });
    });
  });
});
