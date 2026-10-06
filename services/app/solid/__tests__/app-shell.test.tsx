/* @jsxImportSource solid-js */
/**
 * The minimal Solid shell end to end in jsdom: the real SessionProvider and page-data store (no
 * mocks but fetch), the browser-history router, and each route arriving as its own lazy module.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';
import { REFRESH_EVENT } from '@/web/page-data-events';

let session: unknown;
let calls: string[];

beforeEach(() => {
  calls = [];
  session = { user: { id: 'usr_1', email: 'owner@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url) === '/api/page/session') return new Response(JSON.stringify(session), { status: 200 });
    if (String(url) === '/api/page/trash') return new Response(JSON.stringify({ files: [{ id: 'doc_1', title: 'Quarterly Review', format: 'markup', version: 3, deleted_at: '2026-09-05T06:00:00.000Z' }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
});

afterEach(async () => {
  cleanup();
  // Redirects can unmount a route before its lazy import finishes. Drain that import
  // while this environment still exists so later files can reuse the module graph.
  await vi.dynamicImportSettled();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Solid shell', () => {
  it('refreshes restored page data on browser Back without refetching on an ordinary pageshow', async () => {
    let title = 'Before creation';
    const existing = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => String(input) === '/api/page/trash'
      ? Response.json({ files: [{ id: 'doc_1', title, format: 'markup', version: 1, deleted_at: '2026-09-05T06:00:00.000Z' }] })
      : existing(input, init));
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    await vi.dynamicImportSettled();
    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('Before creation');
    title = 'After creation';
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: false }));
    expect(table).toHaveTextContent('Before creation');
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
    await waitFor(() => expect(table).toHaveTextContent('After creation'));
  });

  it('shows live agent and unread notification counts in the sidebar', async () => {
    let online = true;
    let unread = 3;
    const existing = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/remote/sessions') return new Response(JSON.stringify({ sessions: [
        { id: 'online', online, exitCode: null },
        { id: 'starting', online: false, runId: 'run_1', activity: 'starting', exitCode: null },
        { id: 'offline', online: false, exitCode: null },
        { id: 'ended', online: true, exitCode: 0 },
      ] }));
      if (String(input) === '/api/my/people') return new Response(JSON.stringify({ notifications: [], blocks: [], unread, next: null }));
      return existing(input, init);
    });
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    await vi.dynamicImportSettled();
    const nav = await screen.findByRole('navigation', { name: 'Workspace' });
    expect(await within(nav).findByLabelText('2 connected agents')).toHaveTextContent('2');
    expect(await within(nav).findByLabelText('3 unread notifications')).toHaveTextContent('3');
    online = false;
    unread = 0;
    fireEvent(window, new Event(REFRESH_EVENT));
    expect(await within(nav).findByLabelText('1 connected agent')).toHaveTextContent('1');
    await waitFor(() => expect(within(nav).queryByLabelText('3 unread notifications')).not.toBeInTheDocument());
    expect(within(nav).queryByLabelText('0 unread notifications')).not.toBeInTheDocument();
  });

  it.each([null, '/api/users/usr_1/avatar?v=1'])('shows account identity in the footer with photo %s', async image => {
    session = { user: { id: 'usr_1', email: 'owner@example.com', username: 'owner', image }, kind: 'account', onboarded: true };
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    await screen.findByRole('table');
    const account = within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Account settings' });
    expect(account).toHaveAttribute('href', '/account');
    await waitFor(() => expect(account).toHaveTextContent('owner@example.com'));
    expect(account).not.toHaveTextContent('Account settings');
    if (image) expect(account.querySelector('img')).toHaveAttribute('src', image);
    else expect(account.querySelector('[data-face-initial]')).toHaveTextContent('O');
  });

  it('links the footer to the signed-in account’s public profile', async () => {
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    await screen.findByRole('table');
    const nav = within(screen.getByRole('navigation', { name: 'Workspace' }));
    expect(await nav.findByRole('link', { name: 'Public profile' })).toHaveAttribute('href', '/@owner');
    expect(nav.getByRole('link', { name: 'Account settings' })).toHaveAttribute('href', '/account');
  });

  it('omits the public profile link until the account has a username', async () => {
    session = { user: { id: 'usr_1', email: 'owner@example.com', username: null, image: null }, kind: 'account', onboarded: true };
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    await screen.findByRole('table');
    const nav = within(screen.getByRole('navigation', { name: 'Workspace' }));
    await waitFor(() => expect(nav.getByRole('link', { name: 'Account settings' })).toHaveTextContent('owner@example.com'));
    expect(nav.queryByRole('link', { name: 'Public profile' })).not.toBeInTheDocument();
  });

  it('mounts /trash under the session and publishes its rows only once the session has a scope', async () => {
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    const table = await screen.findByRole('table');
    await waitFor(() => expect(table).toHaveTextContent('Quarterly Review'));
    expect(calls.filter(url => url === '/api/page/session' || url === '/api/page/trash')).toEqual(['/api/page/session', '/api/page/trash']);
    expect(screen.getByRole('banner', { name: 'Page bar' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Current page' })).toHaveTextContent('trash');
    expect(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Trash' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('navigation', { name: 'Menu' });
    expect(menu).toHaveClass('right-3', 'top-14');
    expect(menu).not.toHaveClass('left-0', 'inset-y-0');
    expect(within(menu).getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/notifications');
    fireEvent.click(screen.getByRole('button', { name: 'Open page controls' }));
    expect(screen.getByRole('group', { name: 'Color mode' })).toBeInTheDocument();
  });

  it('opens the app menu as a phone bottom sheet and follows viewport changes', async () => {
    vi.stubGlobal('innerWidth', 390);
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('navigation', { name: 'Menu' });
    expect(menu).toHaveClass('inset-x-0', 'bottom-0');
    expect(menu).not.toHaveClass('left-0', 'inset-y-0');
    vi.stubGlobal('innerWidth', 1280);
    fireEvent(window, new Event('resize'));
    expect(menu).toHaveClass('right-3', 'top-14');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
  });

  it('routes a new account to welcome even while its home data is pending', async () => {
    session = { user: { id: 'new', email: 'mxmx_test_new@example.com', username: 'new', image: null }, kind: 'account', onboarded: false };
    const existing = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => String(input).startsWith('/api/page/home') ? new Promise<Response>(() => {}) : existing(input, init));
    window.history.replaceState(null, '', '/');
    render(() => <App />);
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/welcome?callbackUrl=%2F'));
    expect(await screen.findByRole('heading', { name: /welcome/ })).toBeInTheDocument();
  });

  it('renders the one 404 for an unknown path, with sign-in for a stranger', async () => {
    session = { user: null, kind: 'none', onboarded: true };
    window.history.replaceState(null, '', '/nowhere?x=1');
    render(() => <App />);
    expect(await screen.findByRole('main', { name: 'Not found' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('banner', { name: 'Page bar' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Back to artifacts')).toHaveAttribute('href', '/');
    await waitFor(() => expect(screen.getByLabelText('Sign in')).toHaveAttribute('href', `/login?callbackUrl=${encodeURIComponent('/nowhere?x=1')}`));
  });

  it('sends a signed-out visitor from /trash to login', async () => {
    session = { user: null, kind: 'none', onboarded: true };
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/login?callbackUrl=/trash'));
  });
});
