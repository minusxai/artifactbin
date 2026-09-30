/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { DocumentPeople } from '../DocumentPeople';
afterEach(() => vi.unstubAllGlobals());

it('shows a pending request without suggesting comment access is blocked', async () => {
  const state = { members: [], pending: [], self: null, canManage: false, canInvite: true };
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === 'POST' ? { ...state, self: { status: 'pending', direction: 'request', user_id: 'reader' } } : state));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentPeople id="abc123" />);
  fireEvent.click(view.getByRole('button', { name: 'People' }));
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Request to join' })));
  await waitFor(() => expect(screen.getByText('Waiting for an owner or editor to approve.')).toBeTruthy());
  expect(screen.getByText('Comment access does not depend on joining.')).toBeTruthy();
  expect(fetcher.mock.calls.some(([, init]) => init?.body === JSON.stringify({ action: 'join' }))).toBe(true);
});

it('offers explicit access sharing and unrestricted invitation lookup', async () => {
  const state = { members: [], pending: [], self: null, canManage: true, canInvite: true };
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.includes('?') ? { people: [{ user_id: 'u1', username: 'alex', name: 'Alex' }] } : state));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentPeople id="abc123" />);
  fireEvent.click(view.getByRole('button', { name: 'People' }));
  fireEvent.focus(await waitFor(() => screen.getByRole('combobox', { name: 'Find people by username' })));
  fireEvent.click(await waitFor(() => screen.getByRole('option', { name: /@alex/ })));
  expect(screen.getByRole('button', { name: 'Remove @alex' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include viewing access' }));
  fireEvent.click(screen.getByRole('button', { name: 'Invite 1 people' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.body === JSON.stringify({ action: 'invite', usernames: ['@alex'], includeAccess: true }))).toBe(true));
  expect(fetcher.mock.calls.some(([url]) => url.includes('purpose=invite'))).toBe(true);
});

it('reports malformed membership responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ visibility: 'public' })));
  const view = render(() => <DocumentPeople id="abc123" />);
  fireEvent.click(view.getByRole('button', { name: 'People' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load people'));
});

it('opens a pending invitation and permits an accepted member to explicitly join', async () => {
  let explicit = false;
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') explicit = true;
    return Response.json({ members: [], pending: [], self: { status: 'accepted', direction: 'invitation', explicit_join: explicit }, canManage: false, canInvite: false });
  });
  vi.stubGlobal('fetch', fetcher);
  render(() => <DocumentPeople id="abc123" initialOpen />);
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Join artifact' })));
  await waitFor(() => expect(screen.getByText('You’re a member')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Join artifact' })).toBeNull();
});
