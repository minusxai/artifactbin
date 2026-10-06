/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '@/solid/App';
import { CustomDomainCard } from '@/solid/components/CustomDomainCard';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('creates, edits and removes a custom path while preserving homepage settings', async () => {
  const paths = new Map<string, string>();
  const saves: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      saves.push(body);
      if (body.artifactId === null) paths.delete(body.path); else paths.set(body.path, body.artifactId);
      return Response.json({});
    }
    return Response.json({ enabled: true, target: 'edge.example.net', targetAddresses: [], homepageOptions: [{ id: 'doc_1', title: 'About us' }, { id: 'doc_2', title: 'Our story' }], domain: { hostname: 'blog.example.com', status: 'verified', txtName: '_verify.blog.example.com', txtValue: 'proof', target: 'edge.example.net', verifiedAt: null, missingSince: null, homepageArtifactId: 'doc_2', pathOverrides: Array.from(paths, ([path, artifactId]) => ({ path, artifactId })) } });
  }));
  render(() => <CustomDomainCard />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add custom path' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Custom path' }), { target: { value: '/about' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Path document' }), { target: { value: 'doc_1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save custom path' }));
  expect(await screen.findByRole('link', { name: '/about' })).toHaveAttribute('href', 'https://blog.example.com/about');
  expect(saves).toEqual([{ path: '/about', artifactId: 'doc_1' }]);
  expect(screen.getByRole('combobox', { name: 'Domain homepage' })).toHaveValue('doc_2');
  fireEvent.click(screen.getByRole('button', { name: 'Edit path /about' }));
  expect(screen.getByRole('combobox', { name: 'Path document' })).toHaveValue('doc_1');
  fireEvent.change(screen.getByRole('combobox', { name: 'Path document' }), { target: { value: 'doc_2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save custom path' }));
  await waitFor(() => expect(saves).toHaveLength(2));
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Path document' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Remove path /about' }));
  await waitFor(() => expect(saves).toEqual([{ path: '/about', artifactId: 'doc_1' }, { path: '/about', artifactId: 'doc_2' }, { path: '/about', artifactId: null }]));
  await waitFor(() => expect(screen.queryByRole('link', { name: '/about' })).not.toBeInTheDocument());
});

it('keeps a failed path edit available to correct and reports the refusal', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return Response.json({ error: 'invalid_path' }, { status: 422 });
    return Response.json({ enabled: true, target: 'edge.example.net', targetAddresses: [], homepageOptions: [{ id: 'doc_1', title: 'About us' }], domain: { hostname: 'blog.example.com', status: 'verified', txtName: '_verify.blog.example.com', txtValue: 'proof', target: 'edge.example.net', verifiedAt: null, missingSince: null, homepageArtifactId: null, pathOverrides: [] } });
  }));
  render(() => <CustomDomainCard />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add custom path' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Custom path' }), { target: { value: '/api/test' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Path document' }), { target: { value: 'doc_1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save custom path' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a path');
  expect(screen.getByRole('textbox', { name: 'Custom path' })).toHaveValue('/api/test');
});
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

it('bounds connections to five rows and separates inactive history', async () => {
  const tokens = Array.from({ length: 12 }, (_, index) => ({ id: `tok_${index}`, name: `Connection ${index}`, status: index < 7 ? 'active' : 'expired', created_at: '2026-01-01', deleted_at: null, expires_at: null, last_used_at: null }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') return Response.json({ username: 'owner', image: null });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/domain') return Response.json({ enabled: false, target: null, targetAddresses: [], domain: null });
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


it('saves a custom-domain homepage and can restore the document listing', async () => {
  let homepageArtifactId: string | null = null;
  const saves: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/page/session') return Response.json({ user: { id: 'usr_1', email: 'a@example.com', username: 'owner', image: null }, kind: 'account', onboarded: true });
    if (url === '/api/page/account') return Response.json({ username: 'owner', image: null });
    if (url === '/api/my/people') return Response.json({ autoAccept: false, unread: 0, next: null, blocks: [], notifications: [] });
    if (url === '/api/my/domain') {
      if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); saves.push(body); homepageArtifactId = body.homepageArtifactId; return Response.json({}); }
      return Response.json({ enabled: true, target: 'edge.example.net', targetAddresses: [], homepageOptions: [{ id: 'doc_1', title: 'My homepage' }], domain: { hostname: 'blog.example.com', status: 'verified', txtName: '_verify.blog.example.com', txtValue: 'proof', target: 'edge.example.net', verifiedAt: null, missingSince: null, homepageArtifactId } });
    }
    if (url === '/api/my/tokens') return Response.json({ tokens: [] });
    return Response.json({});
  }));
  window.history.replaceState(null, '', '/account');
  render(() => <App />);
  const select = await screen.findByRole('combobox', { name: 'Domain homepage' });
  fireEvent.change(select, { target: { value: 'doc_1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save homepage' }));
  await waitFor(() => expect(saves).toEqual([{ homepageArtifactId: 'doc_1' }]));
  expect(await screen.findByText('Homepage saved.')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Domain homepage' })).toHaveValue('doc_1');
  expect(screen.getByRole('button', { name: 'Save homepage' })).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Domain homepage' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save homepage' }));
  await waitFor(() => expect(saves).toEqual([{ homepageArtifactId: 'doc_1' }, { homepageArtifactId: null }]));
});
