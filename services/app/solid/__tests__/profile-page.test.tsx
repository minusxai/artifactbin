/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('renders the public profile, filters its shelf, and follows with the server answer', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/page/session') return Response.json({ user: { id: 'reader', email: 'r@example.com', username: 'reader', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/page/profile/%40cee') return Response.json({ kind: 'public-profile', handle: 'cee', owner: { id: 'owner', image: null }, social: { following: 2, followers: 3, relation: { youFollow: false, followsYou: true, known: [], knownTotal: 0 } }, authed: true, anon: false, files: [
      { id: 'a', title: 'First note', description: 'hello', format: 'markup', version: 1, updated_at: '2026-09-28T12:00:00Z' },
      { id: 'b', title: 'Second note', format: 'markup', version: 1, updated_at: '2026-09-27T12:00:00Z' },
      { id: 'asset', title: 'Asset', format: 'image', version: 1, updated_at: '2026-09-27T12:00:00Z' },
      { id: 'folder', title: 'Reports', format: 'folder', version: 1, updated_at: '2026-09-27T12:00:00Z' },
    ] });
    if (url === '/api/users/owner/follow') return Response.json({ following: true, count: 4 });
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/@cee');
  render(() => <App />);
  expect(await screen.findByRole('link', { name: 'Profile root' })).toHaveTextContent('@cee');
  expect(screen.getByRole('button', { name: 'Follow back' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Follow back' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByRole('group', { name: 'Follows' })).toHaveTextContent('4 Followers');
  expect(screen.getByRole('region', { name: 'Artifact grid' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open First note' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open folder Reports' }).querySelector('svg')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Open Asset' })).toBeNull();
  fireEvent.input(screen.getByRole('textbox', { name: 'Search artifacts' }), { target: { value: 'second' } });
  expect(screen.queryByRole('link', { name: 'Open First note' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Open Second note' })).toBeInTheDocument();
  expect(calls).toContain('POST /api/users/owner/follow');
});
