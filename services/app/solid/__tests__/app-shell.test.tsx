/* @jsxImportSource solid-js */
/**
 * The minimal Solid shell end to end in jsdom: the real SessionProvider and page-data store (no
 * mocks but fetch), the browser-history router, and each route arriving as its own lazy module.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';

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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('Solid shell', () => {
  it('mounts /trash under the session and publishes its rows only once the session has a scope', async () => {
    window.history.replaceState(null, '', '/trash');
    render(() => <App />);
    const table = await screen.findByRole('table');
    await waitFor(() => expect(table).toHaveTextContent('Quarterly Review'));
    expect(calls.filter(url => url === '/api/page/session' || url === '/api/page/trash')).toEqual(['/api/page/session', '/api/page/trash']);
    expect(screen.getByRole('banner', { name: 'Page bar' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Current page' })).toHaveTextContent('trash');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('navigation', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/notifications');
    fireEvent.click(screen.getByRole('button', { name: 'Open page controls' }));
    expect(screen.getByRole('group', { name: 'Color mode' })).toBeInTheDocument();
  });

  it('renders the one 404 for an unknown path, with sign-in for a stranger', async () => {
    session = { user: null, kind: 'none', onboarded: true };
    window.history.replaceState(null, '', '/nowhere?x=1');
    render(() => <App />);
    expect(await screen.findByRole('main', { name: 'Not found' })).toBeInTheDocument();
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
