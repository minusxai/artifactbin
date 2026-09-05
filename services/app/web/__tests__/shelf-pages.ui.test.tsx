/**
 * THE HOMEPAGE WORKSPACE AND PUBLIC PROFILE: EACH HAS ONE PRIMARY SURFACE.
 *
 * Ported from master's `page-column`, `dashboard-shape` and `profile-shelf`
 * tests, which rendered the Next pages this branch replaced. The RULES are
 * master's and unchanged — only the thing being rendered moved:
 *
 *  - A populated homepage widens for a primary shelf plus a narrow dashboard
 *    rail; the public profile remains a calm single-column shelf.
 *  - The shelf comes first in the document and the dashboard is secondary, so
 *    phones encounter the working surface before analytics.
 *  - A profile renders only the public shelf with owner capabilities withheld.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import HeaderBar from '@/components/HeaderBar';
import { renderToStaticMarkup } from 'react-dom/server';
import { REFRESH_EVENT } from '@/lib/navigation';
import { router as routerDouble, resetRouter } from '@/test/setup/router';
import { HomePage } from '@/web/pages/Home';
import { ProfilePage } from '@/web/pages/Profile';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_c', email: 'c@x.io' } } }) }));
vi.mock('@/components/viz/VegaChart', () => ({
  VegaChart: ({ ariaLabel }: { ariaLabel?: string }) => <div aria-label={ariaLabel ?? 'Vega chart'} />,
}));

const doc = (id: string) => ({
  id, url: `/a/${id}`, title: `Doc ${id}`, description: null, format: 'markup', version: 1,
  visibility: 'public', parent_id: null, ancestor_ids: [], updated_at: '2026-08-20T00:00:00.000Z', views: 0, sparkline: null,
});
const profileDoc = (id: string) => ({
  id, title: `Doc ${id}`, format: 'markup', version: 1, visibility: 'public', folder: '',
  created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z',
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

describe('the homepage workspace and profile column', () => {
  it('widens a populated home for the dashboard rail while keeping profiles focused', async () => {
    home = { signedIn: true, artifacts: [doc('a'), doc('b')], viewsOverTime: [], shared: [] };
    profile = { kind: 'public-profile', handle: 'cee', files: [profileDoc('a')], email: 'c@x.io', authed: true, anon: false };

    const dash = render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(mainWidth(dash.container)).toBe('max-w-[80rem]'));
    expect(screen.getByLabelText('Home workspace')).toBeInTheDocument();
    expect(screen.getByLabelText('Dashboard rail')).toBeInTheDocument();
    cleanup();

    const prof = render(<MemoryRouter initialEntries={['/@cee']}><Routes><Route path="/:user/*" element={<ProfilePage />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(mainWidth(prof.container)).toBeDefined());
    expect(mainWidth(prof.container)).toBe('max-w-4xl');
  });

  it('keeps the masthead aligned with the standard profile column', () => {
    const masthead = renderToStaticMarkup(HeaderBar({ authed: true }) as React.ReactElement);
    expect(masthead).toContain('max-w-4xl');
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

  it('WITH artifacts: leads with the Drive-like shelf and keeps analytics in the right rail', async () => {
    home = {
      signedIn: true,
      artifacts: [
        { ...doc('a'), views: 7 },
        { ...doc('data'), title: 'Dataset', format: 'dataset', views: 99 },
      ],
      viewsOverTime: [0, 2, 5],
      likes: 3,
      likesOverTime: [0, 1, 2],
      followers: 4,
      forks: 2,
      shared: [],
      feed: {
        mine: [{ id: 'evt_1', at: new Date().toISOString(), verb: 'viewed', subject: { kind: 'user', id: 'usr_c', handle: 'cee' }, object: { kind: 'artifact', id: 'a', title: 'Doc a' }, payload: {} }],
        following: [],
      },
    };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open Doc a')).toBeInTheDocument());
    const dashboard = screen.getByLabelText('Dashboard');
    const shelf = screen.getByLabelText('Shelf');
    const metrics = within(screen.getByLabelText('Dashboard metrics'));
    const valueFor = (label: string) => metrics.getByText(label).closest('dt')?.nextElementSibling;
    expect(valueFor('artifacts')).toHaveTextContent('1');
    expect(valueFor('assets')).toHaveTextContent('1');
    expect(valueFor('views')).toHaveTextContent('7');
    expect(valueFor('likes')).toHaveTextContent('3');
    expect(valueFor('followers')).toHaveTextContent('4');
    expect(valueFor('forks')).toHaveTextContent('2');
    expect(within(dashboard).getByRole('heading', { name: 'Dashboard' }).querySelector('svg')).toBeTruthy();
    expect(dashboard).not.toHaveTextContent('Your artifacts');
    expect(dashboard).not.toHaveTextContent('Your posts');
    expect(dashboard).not.toHaveTextContent('all time');
    expect(dashboard).toHaveTextContent('Engagement over time');
    expect(screen.getByRole('group', { name: 'Interactive engagement chart: 7 views and 3 likes in the last 30 days' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Engagement Vega chart')).toBeInTheDocument();
    expect(dashboard).not.toHaveTextContent('Views by post');
    expect(shelf.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('Dashboard rail')).toContainElement(dashboard);
    expect(screen.getByLabelText('Dashboard rail')).toHaveClass('lg:pt-24');
    const activity = screen.getByLabelText('Activity');
    expect(screen.getByLabelText('Dashboard rail')).toContainElement(activity);
    expect(activity).toHaveAttribute('data-layout', 'rail');
    expect(dashboard.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const create = screen.getByLabelText('Create');
    expect(screen.getAllByLabelText('Create')).toHaveLength(1);
    expect(create.compareDocumentPosition(shelf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(create.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('Assets')).toHaveAttribute('href', '/assets');
    expect(screen.getByLabelText('Trash')).toHaveAttribute('href', '/trash');
    expect(screen.getByLabelText('Artifact grid')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Assets' })).toBeNull();
    expect(screen.queryByLabelText('Get started')).toBeNull();
    expect(screen.queryByLabelText('What you can use it for')).toBeNull();
  });

  it('shows only root files on Home while dashboard totals still include filed artifacts', async () => {
    home = {
      signedIn: true,
      artifacts: [
        doc('root'),
        { ...doc('folder'), title: 'Research', format: 'folder' },
        { ...doc('filed'), parent_id: 'folder', ancestor_ids: ['folder'] },
      ],
      viewsOverTime: [],
      shared: [],
    };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText('Open Doc root')).toBeInTheDocument());
    expect(screen.getByLabelText('Open folder Research')).toBeInTheDocument();
    expect(screen.queryByLabelText('Open Doc filed')).toBeNull();

    const metrics = within(screen.getByLabelText('Dashboard metrics'));
    const artifacts = metrics.getByText('artifacts').closest('dt')?.nextElementSibling;
    expect(artifacts).toHaveTextContent('2');
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

  it('WITHOUT owned artifacts: shared work remains primary and the zero-state dashboard is secondary', async () => {
    home = {
      signedIn: true,
      artifacts: [],
      shared: [{ ...doc('shared'), description: null, role: 'viewer', owner_username: 'alice' }],
    };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const dashboard = await screen.findByLabelText('Dashboard');
    const shared = await screen.findByLabelText('Open shared artifact shared');
    expect(dashboard).toHaveTextContent('0');
    expect(shared.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    await screen.findByLabelText('Open Doc a');
    expect(screen.queryByLabelText(/create your first artifact/i)).toBeNull();

    // THE RULE: the flip does not take the answer with it.
    expect(screen.getByLabelText('Claim result')).toHaveTextContent(/Added/);
  });
});

const atProfile = () =>
  render(<MemoryRouter initialEntries={['/@cee']}><Routes><Route path="/:user/*" element={<ProfilePage />} /></Routes></MemoryRouter>);

describe('a profile', () => {
  it('renders only the public shelf for the files it lists', async () => {
    profile = { kind: 'public-profile', handle: 'cee', files: [profileDoc('a'), profileDoc('b')], email: 'c@x.io', authed: true, anon: false };
    // Mounted under the app's own route: ProfilePage reads `:user` from it,
    // and a bare mount reads nothing — which the typo guard answers with 404.
    atProfile();
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    expect(screen.getByText('Doc b')).toBeInTheDocument();
    expect(screen.getByLabelText('Artifact grid')).toBeInTheDocument();
    expect(screen.queryByLabelText('Dashboard')).toBeNull();
    expect(screen.queryByLabelText('Assets')).toBeNull();
  });

});
