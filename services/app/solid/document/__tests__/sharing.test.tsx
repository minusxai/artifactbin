/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { DocumentSharing } from '../DocumentSharing';

afterEach(() => vi.unstubAllGlobals());

it('opens the owner sharing dialog and changes link visibility through the scoped endpoint', async () => {
  const state = { visibility: 'unlisted', linkRole: 'viewer', shares: [], canPrivate: true };
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === 'PUT' ? { ...state, visibility: 'public' } : state));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentSharing id="abc" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sharing' })).toHaveTextContent('Anyone with the link'));
  fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/my/artifacts/abc/sharing', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ visibility: 'public' }) })));
});

it('copies a clean reader link without loading ACLs', async () => {
  const copy = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentSharing id="abc" title="Report" owner={false} url="/a/abc?version=1#edit" />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  expect(copy).toHaveBeenCalledWith(`${location.origin}/a/abc`);
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps the owner verdict current and closes with Escape', async () => {
  const state = { visibility: 'private', linkRole: 'viewer', shares: [], canPrivate: true };
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === 'PUT' ? { ...state, visibility: 'public' } : state)));
  const view = render(() => <DocumentSharing id="abc" title="Report" owner />);
  await waitFor(() => expect(view.getByRole('button', { name: 'Share' })).toHaveTextContent('private'));
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Share' })).toHaveTextContent('public'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Sharing' })).toBeNull();
});

it('invites an email, changes its role, and removes it under public visibility', async () => {
  const state = { visibility: 'public', linkRole: 'viewer', shares: [] as Array<{ email: string; role: string }>, canPrivate: true };
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const patch = JSON.parse(String(init.body)) as { shares?: typeof state.shares };
      if (patch.shares) state.shares = patch.shares.map(person => ({ ...person, email: person.email.toLowerCase() }));
    }
    return Response.json(state);
  }));
  const view = render(() => <DocumentSharing id="abc" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'People' })).toBeTruthy());
  fireEvent.input(screen.getByRole('textbox', { name: 'Invite email' }), { target: { value: 'Friend@Example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add email' }));
  await waitFor(() => expect(state.shares).toEqual([{ email: 'friend@example.com', role: 'viewer' }]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Role for friend@example.com' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Role for friend@example.com' }));
  fireEvent.click(screen.getByRole('option', { name: 'can edit' }));
  await waitFor(() => expect(state.shares).toEqual([{ email: 'friend@example.com', role: 'editor' }]));
  fireEvent.click(screen.getByRole('button', { name: 'Remove friend@example.com' }));
  await waitFor(() => expect(state.shares).toEqual([]));
});
