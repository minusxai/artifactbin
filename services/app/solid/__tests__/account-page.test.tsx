/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('loads the account handle late while keeping profile controls without the retired data uploader', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') { await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ username: 'owner', image: '/api/users/usr_1/avatar?v=1', user_page_url:'https://owner.u.example.test' }); }
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/tokens') return Response.json({ tokens: [] });
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/account');
  const view = render(() => <App />);
  await vi.dynamicImportSettled();
  expect(await screen.findByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('owner'));
  expect(view.container.querySelector('img[src="/api/users/usr_1/avatar?v=1"]')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'https://owner.u.example.test'})).toHaveAttribute('href','https://owner.u.example.test');
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/api/my/domain'))).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Data' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Upload a CSV')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Google Sheet URL')).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'HTTP authentication guide'})).toHaveAttribute('href','/llms/http-auth');
});

// The accounts gate's claim leg, moved here: a verified account's page lists CLI connections to revoke, and nothing
// anywhere asks a person to paste a token.
it('asks a person for no pasted token anywhere on the account page', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') return Response.json({ username: 'owner', image: null });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/tokens') return Response.json({ tokens: [] });
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/account');
  const view = render(() => <App />);
  await vi.dynamicImportSettled();
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('owner'));
  expect(screen.queryByLabelText('Token to claim')).not.toBeInTheDocument();
  expect(view.container.textContent).not.toMatch(/mx_\.\.\./);
});

it('requires confirmation before revoking a connection', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') return Response.json({ username: 'owner', image: null });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/tokens') return Response.json({ tokens: [{ id: 'tok_1', name: 'Laptop', status: 'active', created_at: '2026-01-01', deleted_at: null, expires_at: null, last_used_at: null }] });
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke token Laptop' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Agents using this token will stop working immediately');
  expect(calls).not.toContain('DELETE /api/my/tokens/tok_1');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
  await waitFor(() => expect(calls).toContain('DELETE /api/my/tokens/tok_1'));
});

it('bounds connections to five rows and separates inactive history', async () => {
  const tokens = Array.from({ length: 12 }, (_, index) => ({ id: `tok_${index}`, name: `Connection ${index}`, status: index < 7 ? 'active' : 'expired', created_at: '2026-01-01', deleted_at: null, expires_at: null, last_used_at: null }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') return Response.json({ username: 'owner', image: null });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/tokens') return Response.json({ tokens });
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  expect(await screen.findByRole('button', { name: 'Active (7)' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('row', { name: /Token row/ })).toHaveLength(5);
  expect(screen.queryByRole('row', { name: 'Token row Connection 7' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next connections page' }));
  expect(screen.getAllByRole('row', { name: /Token row/ })).toHaveLength(2);
  expect(screen.getByRole('row', { name: 'Token row Connection 6' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'History (5)' }));
  expect(screen.getAllByRole('row', { name: /Token row/ })).toHaveLength(5);
  expect(screen.getByRole('row', { name: 'Token row Connection 7' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Previous connections page' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Active (7)' }));
  expect(screen.getByRole('row', { name: 'Token row Connection 0' })).toBeInTheDocument();
});
