/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';
import { stubFetch } from '@/test/helpers/fetch-stub';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it.each(['/@cee', '/@cee/'])('renders the public profile at %s, filters its shelf, and follows with the server answer', async path => {
  const calls: string[] = [];
  stubFetch({
    '/api/my/people': { autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] },
    '/api/page/profile/%40cee': { kind: 'public-profile', handle: 'cee', owner: { name: 'Example Owner', id: 'owner', image: null }, social: { following: 2, followers: 3, relation: { youFollow: false, followsYou: true, known: [{ id: "known", name: "Known Reader", username: "reader" }], knownTotal: 1 } }, authed: true, anon: false, files: [
      { id: 'a', title: 'First note', description: 'hello', format: 'html', version: 1, updated_at: '2026-09-28T12:00:00Z' },
      { id: 'b', title: 'Second note', format: 'html', version: 1, updated_at: '2026-09-27T12:00:00Z' },
      { id: 'asset', title: 'Asset', format: 'image', version: 1, updated_at: '2026-09-27T12:00:00Z' },
      { id: 'folder', title: 'Reports', format: 'folder', version: 1, updated_at: '2026-09-27T12:00:00Z' },
    ] },
    '/api/users/owner/follow': { following: true, count: 4 },
  }, { session: { user: { id: 'reader', email: 'r@example.com', username: 'reader', image: null }, kind: 'account', onboarded: true }, fallback: () => Response.json({}), onCall: (url, init) => { calls.push(`${init?.method ?? 'GET'} ${url}`); } });
  window.history.replaceState(null, '', path);
  render(() => <App />);
  await vi.dynamicImportSettled();
  expect(await screen.findByRole('link', { name: 'Profile root' })).toHaveTextContent('Example Owner');
  expect(screen.getByRole('navigation', { name: 'Current page' })).toHaveTextContent('Example Owner');
  expect(screen.getByRole('link', { name: 'Known Reader' })).toHaveAttribute('href', '/@reader');
  expect(screen.getByRole('button', { name: 'Follow back' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Follow back' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByRole('group', { name: 'Follows' })).toHaveTextContent('4 Followers');
  expect(screen.getByRole('region', { name: 'Artifact grid' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open First note' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open folder Reports' }).querySelector('svg')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Open Asset' })).toBeNull();
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search artifacts' }), { target: { value: 'second' } });
  expect(screen.queryByRole('link', { name: 'Open First note' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Open Second note' })).toBeInTheDocument();
  expect(calls).toContain('POST /api/users/owner/follow');
});
