/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { DocumentPeople } from '../DocumentPeople';
import { resetShared } from '@/lib/http/shared-request';
import { stubFetch } from '@/test/helpers/fetch-stub';
afterEach(() => { vi.unstubAllGlobals(); resetShared(); });

it('shows a pending request without suggesting comment access is blocked', async () => {
  const state = { members: [], pending: [], self: null, canManage: false, canInvite: true };
  const fetcher = stubFetch({ 'POST *': { ...state, self: { status: 'pending', direction: 'request', user_id: 'reader' } } }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentPeople id="abc123" />);
  fireEvent.click(view.getByRole('button', { name: 'People' }));
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Request to join' })));
  await waitFor(() => expect(screen.getByText('Waiting for an owner or editor to approve.')).toBeTruthy());
  expect(screen.getByText('Comment access does not depend on joining.')).toBeTruthy();
  expect(fetcher.mock.calls.some(([, init]) => init?.body === JSON.stringify({ action: 'join' }))).toBe(true);
});

it('offers explicit access sharing and unrestricted invitation lookup', async () => {
  const state = { members: [], pending: [], self: null, canManage: true, canInvite: true, canShare: true };
  const fetcher = stubFetch({ '*?*': { people: [{ user_id: 'u1', username: 'alex', name: 'Alex' }] } }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentPeople id="abc123" />);
  fireEvent.click(view.getByRole('button', { name: 'People' }));
  const finder = await waitFor(() => screen.getByRole('combobox', { name: 'Find people by username' }));
  finder.focus();
  fireEvent.click(finder);
  fireEvent.click(await waitFor(() => screen.getByRole('option', { name: /Alex.*@.*alex/ })));
  expect(screen.getByRole('button', { name: 'Remove Alex' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include viewing access' }));
  fireEvent.click(screen.getByRole('button', { name: 'Invite 1 people' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.body === JSON.stringify({ action: 'invite', usernames: ['@alex'], includeAccess: true }))).toBe(true));
  expect(fetcher.mock.calls.some(([url]) => url.includes('purpose=invite'))).toBe(true);
});

it('offers an editor by link alone invitations without viewing access', async () => {
  stubFetch({ '*?*': { people: [{ user_id: 'u1', username: 'alex', name: 'Alex' }] } }, { fallback: () => Response.json({ members: [], pending: [], self: null, canManage: true, canInvite: true, canShare: false }) });
  const view = render(() => <DocumentPeople id="abc123" />);
  fireEvent.click(view.getByRole('button', { name: 'People' }));
  await waitFor(() => screen.getByRole('combobox', { name: 'Find people by username' }));
  expect(screen.queryByRole('checkbox', { name: 'Include viewing access' })).toBeNull();
});

it('reports malformed membership responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ visibility: 'public' })));
  const view = render(() => <DocumentPeople id="abc123" />);
  fireEvent.click(view.getByRole('button', { name: 'People' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load people'));
});

it('opens a pending invitation and permits an accepted member to explicitly join', async () => {
  let explicit = false;
  const members = () => Response.json({ members: [], pending: [], self: { status: 'accepted', direction: 'invitation', explicit_join: explicit }, canManage: false, canInvite: false });
  stubFetch({ 'POST *': () => { explicit = true; return members(); } }, { fallback: members });
  render(() => <DocumentPeople id="abc123" initialOpen />);
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Join artifact' })));
  await waitFor(() => expect(screen.getByText('You’re a member')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Join artifact' })).toBeNull();
});

it('suggests people in the shared combobox: Escape closes the list, the keyboard picks, and nothing is sent until Invite', async () => {
  const state = { members: [], pending: [], self: null, canManage: false, canInvite: true };
  const fetcher = stubFetch({ '*?*': { people: [{ user_id: 'u1', username: 'alex', name: 'Alex' }, { user_id: 'u2', username: 'bo', name: 'Bo' }] } }, { fallback: () => Response.json(state) });
  render(() => <DocumentPeople id="abc123" initialOpen />);
  const finder = await waitFor(() => screen.getByRole('combobox', { name: 'Find people by username' }));
  // Nothing is looked up until the field is reached.
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('purpose=invite'))).toBe(false);
  finder.focus(); fireEvent.click(finder);
  const list = await waitFor(() => screen.getByRole('listbox', { name: 'People suggestions' }));
  expect(await screen.findAllByRole('option')).toHaveLength(2);
  fireEvent.keyDown(finder, { key: 'Escape' });
  expect(screen.queryByRole('listbox', { name: 'People suggestions' })).toBeNull();
  expect(list.isConnected).toBe(false);
  fireEvent.keyDown(finder, { key: 'ArrowDown' });
  fireEvent.keyDown(finder, { key: 'ArrowDown' });
  fireEvent.keyDown(finder, { key: 'Enter' });
  expect(screen.getByRole('button', { name: 'Remove Bo' })).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('names accepted and pending people without displaying a private identifier for an unnamed person', async () => {
  const state = { members: [{ user_id: 'private-id', username: null, name: '' }, { user_id: 'member', username: 'one', name: 'First Reader' }],
    pending: [{ user_id: 'pending', username: 'two', name: 'Next Reader', direction: 'request' }], self: null, canManage: true, canInvite: false };
  stubFetch({}, { fallback: () => Response.json(state) });
  render(() => <DocumentPeople id="abc123" initialOpen />);
  expect(await screen.findByRole('button', { name: 'Approve Next Reader' })).toBeInTheDocument();
  expect(screen.getByText('First Reader')).toBeInTheDocument();
  expect(screen.getByText('Someone')).toBeInTheDocument();
  expect(screen.queryByText('private-id')).toBeNull();
});
