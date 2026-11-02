/* @jsxImportSource solid-js */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MenuPanel } from '../PageChromePanels';

vi.mock('@solidjs/router', () => ({ useLocation: () => ({ pathname: '/' }) }));
vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session: () => ({ kind: 'account', user: { id: 'mxmx_test_logout', email: 'mxmx_test_logout@example.test' } }) }) }));
vi.mock('../PageBar', () => ({ PageControlsBody: () => null }));
vi.mock('../PeopleInbox', () => ({ PeopleInbox: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('ends document sessions before signing out the email account', async () => {
  let finishPages!: (response: Response) => void;
  const pages = new Promise<Response>(resolve => { finishPages = resolve; });
  const fetch = vi.fn((url: string) => url === '/api/session/token' ? pages : new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetch);
  render(() => <MenuPanel close={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/session/token', { method: 'DELETE', credentials: 'same-origin' });
  finishPages(new Response(null, { status: 204 }));
  await waitFor(() => expect(fetch).toHaveBeenNthCalledWith(2, '/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
});
