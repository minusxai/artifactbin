/**
 * THE CUSTOM DOMAIN SECTION of account settings — by accessible names.
 *
 * Shown when attaching is on, or when the account already has a domain (so it
 * can be removed while the flag is off). It shows the two DNS records, the
 * status, a Verify that says what to change, and Remove.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AccountPage } from '@/web/pages/Account';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_1', email: 'a@example.com' } } }) }));

const pending = { hostname: 'blog.example.com', status: 'pending', txtName: '_artifactbin.blog.example.com', txtValue: 'artifactbin-verify=abc123', target: 'domains.example.test', verifiedAt: null, missingSince: null };
type Answer = { status: number; body: unknown };

/** A scripted server: every call to a path answers the next queued answer (the last one repeats). */
function serve(routes: Record<string, Answer[]>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const queue = routes[`${method} ${path}`];
    if (!queue) return new Response(JSON.stringify({}), { status: 200 });
    const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body), { status: answer.status });
  }));
  return calls;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderPage = () => render(<MemoryRouter><AccountPage /></MemoryRouter>);

describe('the custom domain section', () => {
  it('is absent while attaching is off and the account has no domain', async () => {
    const calls = serve({ 'GET /api/my/domain': [{ status: 200, body: { enabled: false, target: null, targetAddresses: [], domain: null } }] });
    renderPage();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/my/domain')).toBe(true));
    expect(screen.queryByRole('heading', { name: /custom domain/ })).toBeNull();
    expect(screen.queryByLabelText('Custom domain')).toBeNull();
  });

  it('attaches a domain, then shows the routing and TXT records to add', async () => {
    const calls = serve({
      'GET /api/my/domain': [
        { status: 200, body: { enabled: true, target: 'domains.example.test', targetAddresses: ['203.0.113.10'], domain: null } },
        { status: 200, body: { enabled: true, target: 'domains.example.test', targetAddresses: ['203.0.113.10'], domain: pending } },
      ],
      'POST /api/my/domain': [{ status: 201, body: pending }],
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Custom domain'), { target: { value: 'blog.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add custom domain' }));
    const records = await screen.findByRole('table', { name: 'DNS records' });
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/my/domain', body: { hostname: 'blog.example.com' } });
    const rows = within(records).getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(rows).toEqual(['CNAMEblog.example.comdomains.example.test', 'TXT_artifactbin.blog.example.comartifactbin-verify=abc123']);
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy TXT record value' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify custom domain' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove custom domain' })).toBeInTheDocument();
  });

  it('says why an attach was refused', async () => {
    serve({
      'GET /api/my/domain': [{ status: 200, body: { enabled: true, target: 'domains.example.test', targetAddresses: [], domain: null } }],
      'POST /api/my/domain': [{ status: 409, body: { error: 'taken' } }],
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Custom domain'), { target: { value: 'blog.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add custom domain' }));
    expect(await screen.findByRole('status')).toHaveTextContent('another account already uses that domain');
  });

  it('names the failing check on Verify — a proxied record is told to go DNS only — and shows verified on success', async () => {
    serve({
      'GET /api/my/domain': [
        { status: 200, body: { enabled: true, target: 'domains.example.test', targetAddresses: [], domain: pending } },
        { status: 200, body: { enabled: true, target: 'domains.example.test', targetAddresses: [], domain: { ...pending, status: 'verified' } } },
      ],
      'POST /api/my/domain/verify': [
        { status: 422, body: { error: 'not_pointing' } },
        { status: 422, body: { error: 'caa_blocks' } },
        { status: 200, body: { ...pending, status: 'verified' } },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify custom domain' }));
    expect(await screen.findByRole('status')).toHaveTextContent('set the record to DNS only');
    fireEvent.click(screen.getByRole('button', { name: 'Verify custom domain' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('letsencrypt.org'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify custom domain' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Verified.'));
    expect(await screen.findByText('verified')).toBeInTheDocument();
  });

  it('offers an ALIAS or A record for a bare domain', async () => {
    serve({ 'GET /api/my/domain': [{ status: 200, body: { enabled: true, target: 'domains.example.test', targetAddresses: ['203.0.113.10', '2001:db8::10'], domain: { ...pending, hostname: 'example.com', txtName: '_artifactbin.example.com' } } }] });
    renderPage();
    const records = await screen.findByRole('table', { name: 'DNS records' });
    const rows = within(records).getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(rows).toEqual(['ALIASexample.comdomains.example.test', 'Aexample.com203.0.113.10', 'TXT_artifactbin.example.comartifactbin-verify=abc123']);
  });

  it('keeps a domain removable while attaching is off, with no Verify', async () => {
    const calls = serve({
      'GET /api/my/domain': [
        { status: 200, body: { enabled: false, target: null, targetAddresses: [], domain: { ...pending, status: 'verified', target: null } } },
        { status: 200, body: { enabled: false, target: null, targetAddresses: [], domain: null } },
      ],
      'DELETE /api/my/domain': [{ status: 204, body: null }],
    });
    renderPage();
    const remove = await screen.findByRole('button', { name: 'Remove custom domain' });
    expect(screen.queryByRole('button', { name: 'Verify custom domain' })).toBeNull();
    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole('heading', { name: /custom domain/ })).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/my/domain')).toBe(true);
  });
});
