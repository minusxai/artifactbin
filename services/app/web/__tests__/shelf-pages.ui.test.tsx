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
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import HeaderBar from '@/components/HeaderBar';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomePage } from '@/web/pages/Home';
import { ProfilePage } from '@/web/pages/Profile';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_c', email: 'c@x.io' } } }) }));

const doc = (id: string) => ({
  id, url: `/a/${id}`, title: `Doc ${id}`, description: null, format: 'markup', version: 1,
  visibility: 'public', folder: '', updated_at: '2026-08-20T00:00:00.000Z', views: 0, sparkline: null,
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
    profile = { kind: 'owner-listing', handle: 'cee', folder: '', folders: [], files: [doc('a')], total: 1, stats: { total: 1, formats: { markup: 1 } }, email: 'c@x.io' };

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

  it('WITH artifacts: the connect door and the shelf, not the teaching rail', async () => {
    home = { signedIn: true, artifacts: [doc('a')], shared: [] };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    expect(screen.getByLabelText(/connect an agent/i)).toBeInTheDocument();
    // The once-ever utilities are not permanent furniture.
    expect(screen.queryByText(/claim an agent's artifacts/i)).toBeNull();
  });

  it('WITHOUT owned artifacts: connect still leads shared work and account utilities stay away', async () => {
    home = {
      signedIn: true,
      artifacts: [],
      shared: [{ ...doc('shared'), description: null, role: 'viewer', owner_username: 'alice' }],
    };
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    const connect = await screen.findByLabelText('Connect an agent');
    const shared = await screen.findByLabelText('Open shared artifact shared');
    expect(connect.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText('Claim a token')).toBeNull();
    expect(screen.queryByLabelText('Add data')).toBeNull();
  });
});

describe('a profile', () => {
  it('renders the shelf for the files it lists', async () => {
    profile = { kind: 'owner-listing', handle: 'cee', folder: '', folders: [], files: [doc('a'), doc('b')], total: 2, stats: { total: 2, formats: { markup: 2 } }, email: 'c@x.io' };
    // Mounted under the app's own route: ProfilePage reads `:user` from it,
    // and a bare mount reads nothing — which the typo guard answers with 404.
    render(<MemoryRouter initialEntries={['/@cee']}><Routes><Route path="/:user/*" element={<ProfilePage />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Doc a')).toBeInTheDocument());
    expect(screen.getByText('Doc b')).toBeInTheDocument();
  });
});
