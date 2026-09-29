/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('loads the account handle late while keeping the photo and data controls mounted', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') { await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ username: 'owner', image: '/api/users/usr_1/avatar?v=1' }); }
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/domain') return Response.json({ enabled: false, target: null, targetAddresses: [], domain: null });
    if (url === '/api/my/tokens') return Response.json({ tokens: [] });
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/account');
  const view = render(() => <App />);
  expect(await screen.findByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Username' }) as HTMLInputElement).value).toBe('owner'));
  expect(view.container.querySelector('img[src="/api/users/usr_1/avatar?v=1"]')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument();
  expect(screen.getByLabelText('Upload a CSV')).toBeInTheDocument();
  expect(screen.getByText(/afbin CLI connection/)).toBeInTheDocument();
});

it('shows an attached domain’s DNS records and verifies through its named action', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') return Response.json({ username: 'owner', image: null });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/domain') return Response.json({ enabled: true, target: 'edge.example.net', targetAddresses: [], domain: { hostname: 'blog.example.com', status: 'pending', txtName: '_verify.blog.example.com', txtValue: 'proof', target: 'edge.example.net', verifiedAt: null, missingSince: null } });
    if (url === '/api/my/domain/verify') return Response.json({});
    if (url === '/api/my/tokens') return Response.json({ tokens: [] });
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  expect(await screen.findByRole('table', { name: 'DNS records' })).toHaveTextContent('_verify.blog.example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Verify custom domain' }));
  await waitFor(() => expect(calls).toContain('POST /api/my/domain/verify'));
});

it('requires confirmation before revoking a connection', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') return Response.json({ username: 'owner', image: null });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/domain') return Response.json({ enabled: false, target: null, targetAddresses: [], domain: null });
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

it('publishes an uploaded CSV with the account session and shows its reference', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') return Response.json({ username: 'owner', image: null });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/domain') return Response.json({ enabled: false, target: null, targetAddresses: [], domain: null });
    if (url === '/api/my/tokens') return Response.json({ tokens: [] });
    if (url === '/api/my/artifacts') return Response.json({ id: 'data_1', title: 'numbers', columns: [{ name: 'value', type: 'integer' }], rowCount: 1 });
    if (url === '/a/data_1/raw') return Response.json([{ value: 2 }]);
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  const file = await screen.findByLabelText('CSV file') as HTMLInputElement;
  fireEvent.change(file, { target: { files: [new File(['value\n2'], 'numbers.csv', { type: 'text/csv' })] } });
  await waitFor(() => expect(calls.some(call => call.url === '/api/my/artifacts' && call.init?.method === 'POST')).toBe(true));
  expect(await screen.findByRole('button', { name: 'Copy dataset reference' })).toHaveTextContent('ref:data_1');
});
