/* @jsxImportSource solid-js */
/** Link intent starts a page's data ahead of its chunk; the page joins it instead of fetching twice. */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';
import { preloadKeyFor } from '@/solid/lib/use-page-data';

let calls: string[];
beforeEach(() => {
  calls = [];
  window.history.replaceState(null, '', '/trash');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url) === '/api/page/session') return new Response(JSON.stringify({ user: { id: 'usr_1', email: 'o@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true }), { status: 200 });
    if (String(url).startsWith('/api/page/home?part=bootstrap')) return new Response(JSON.stringify({ signedIn: true, accountId: 'usr_1', deployment: { mode: 'public', setup_complete: true, is_owner: false, default_group: null }, preferences: { default_destination: { type: 'group', id: 'g1' } }, destination: { kind: 'group', groupId: 'g1', detail: { group: { id: 'g1', handle: 'team', name: 'Team', description: '', role: 'editor' }, members: [], linked_groups: [] }, core: { artifacts: [], shared: [] } } }), { status: 200 });
    if (String(url).startsWith('/api/page/profile/')) return new Response(JSON.stringify({ kind: 'public-profile', handle: 'sam', files: [] }), { status: 200 });
    return new Response(JSON.stringify({ files: [] }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('preloadKeyFor', () => {
  it.each([
    ['/', '/api/page/home?part=bootstrap'],
    ['/?personal=1', '/api/page/home?part=bootstrap&personal=1'],
    ['/?utm=1', '/api/page/home?part=bootstrap'],
    ['/@sam', '/api/page/profile/%40sam'],
    ['/@sam/', '/api/page/profile/%40sam'],
    ['/a/abc', null],
    ['/@sam/doc', null],
    ['/account', null],
    ['https://elsewhere.example/@sam', null],
  ])('%s -> %s', (href, key) => expect(preloadKeyFor(href, 'http://localhost:3000')).toBe(key));
});

describe('link intent', () => {
  it('hovering a profile link fetches it once; the page then adopts it without a second request', async () => {
    render(() => <App />);
    await screen.findByRole('region', { name: 'Trash' }, { timeout: 3000 });
    const link = document.createElement('a');
    link.href = '/@sam'; link.textContent = 'sam'; document.body.append(link);
    fireEvent.pointerOver(link, { pointerType: 'mouse' });
    await waitFor(() => expect(calls.filter((u) => u === '/api/page/profile/%40sam')).toHaveLength(1));
    fireEvent.pointerDown(link);
    fireEvent.focusIn(link);
    window.history.pushState(null, '', '/@sam'); window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.getByText('0 public artifacts', { exact: true })).toBeInTheDocument(), { timeout: 4000 });
    expect(calls.filter((u) => u === '/api/page/profile/%40sam')).toHaveLength(1);
  });
});

describe('Home link intent', () => {
  it('preloads the destination bootstrap, never the personal shelf, and the page adopts it without a second request', async () => {
    render(() => <App />);
    await screen.findByRole('region', { name: 'Trash' }, { timeout: 3000 });
    const link = document.createElement('a');
    link.href = '/'; link.textContent = 'home'; document.body.append(link);
    fireEvent.pointerOver(link, { pointerType: 'mouse' });
    await waitFor(() => expect(calls.filter((u) => u === '/api/page/home?part=bootstrap')).toHaveLength(1));
    window.history.pushState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));
    await screen.findByRole('heading', { name: 'Team' }, { timeout: 4000 });
    expect(calls.filter((u) => u === '/api/page/home?part=bootstrap')).toHaveLength(1);
    expect(calls.filter((u) => u.includes('part=core') || u.startsWith('/api/me/preferences') || u.startsWith('/api/groups/'))).toEqual([]);
  });
});
