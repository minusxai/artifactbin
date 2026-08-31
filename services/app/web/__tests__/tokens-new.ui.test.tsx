/**
 * /tokens/new — the credential is a link (tok-p2, plan §3b).
 *
 * ONE page for both states: a confirm step with an expiry picker ("Expires in", default 6 h) → POST
 * /api/tokens/anonymous { expiresInHours } → the secret shown ONCE with "Copy token" → logged-out ONLY, the page
 * exchanges the secret for the agent cookie (POST /api/session/token); logged-in, the route already bound the token
 * to the account and no exchange happens. Never a GET that mints: nothing is fetched on render, and a fresh render
 * after a mint shows the confirm step again, never the secret.
 *
 * Seeded RED by the orchestrator; make it green without changing an expectation.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { HomePage } from '@/web/pages/Home';
import { TokensNewPage } from '@/web/pages/TokensNew';

const SECRET = 'mx_' + 'a'.repeat(43);
const EXPIRES = '2026-09-01T00:00:00.000Z';
type Session = { user: { id: string; email: string | null } | null; kind: 'account' | 'anon' | 'none'; stats: null; mixpanel: { token: null; host: string } };
let session: Session;
vi.mock('@/web/session', () => ({ useSession: () => ({ session, reload: () => {} }) }));

let mints: Array<Record<string, unknown>>;
let exchanges: Array<Record<string, unknown>>;
let copied: string[];

beforeEach(() => {
  session = { user: null, kind: 'none', stats: null, mixpanel: { token: null, host: '' } };
  mints = []; exchanges = []; copied = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/api/tokens/anonymous')) {
      expect(init?.method).toBe('POST');
      mints.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ id: 'tok_1', token: SECRET, expiresAt: EXPIRES }), { status: 201 });
    }
    if (u.endsWith('/api/session/token')) {
      expect(init?.method).toBe('POST');
      exchanges.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (s: string) => { copied.push(s); } }, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = () => render(<MemoryRouter><TokensNewPage /></MemoryRouter>);
const generate = () => screen.getByRole('button', { name: 'Generate a token' });

describe('/tokens/new', () => {
  it('mints nothing on render; the confirm step is what mints, with the picked expiry', async () => {
    page();
    expect(generate()).toBeTruthy();
    expect(mints).toEqual([]);
    const picker = screen.getByLabelText('Expires in') as HTMLSelectElement;
    expect(picker.value).toBe('6');
    fireEvent.change(picker, { target: { value: '24' } });
    fireEvent.click(generate());
    await screen.findByText(SECRET);
    expect(mints).toEqual([{ expiresInHours: 24 }]);
  });

  it('logged out: the secret is exchanged for the agent cookie once, and never stored', async () => {
    page();
    fireEvent.click(generate());
    await screen.findByText(SECRET);
    await waitFor(() => expect(exchanges).toEqual([{ token: SECRET }]));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('logged in: the token is the account\'s already — no exchange', async () => {
    session = { user: { id: 'usr_1', email: 'a@example.com' }, kind: 'account', stats: null, mixpanel: { token: null, host: '' } };
    page();
    fireEvent.click(generate());
    await screen.findByText(SECRET);
    await new Promise((r) => setTimeout(r, 20));
    expect(exchanges).toEqual([]);
  });

  it('shows when it expires and copies the secret on demand', async () => {
    page();
    fireEvent.click(generate());
    await screen.findByText(SECRET);
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    await waitFor(() => expect(copied).toEqual([SECRET]));
    expect(screen.getByText(/expires/i)).toBeTruthy();
  });

  it('a fresh render after a mint shows the confirm step, not the secret', async () => {
    page();
    fireEvent.click(generate());
    await screen.findByText(SECRET);
    cleanup();
    page();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(generate()).toBeTruthy();
    expect(mints).toHaveLength(1);
  });

  it('keeps the confirm step usable when minting fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })));
    page();
    fireEvent.click(generate());
    expect(await screen.findByText(/could not generate/i)).toBeTruthy();
    expect(generate()).not.toBeDisabled();
    expect(screen.queryByText(SECRET)).toBeNull();
  });
});

describe('anonymous home drafts', () => {
  it('renders the held-browser shelf and login nudge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      signedIn: false,
      drafts: [{
        id: 'art_draft', url: '/a/art_draft', title: 'Browser draft', format: 'markup',
        version: 1, updated_at: '2026-08-31T00:00:00.000Z', visibility: 'unlisted',
      }],
    }), { status: 200 })));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(await screen.findByText(/held by this browser/i)).toBeTruthy();
    expect(screen.getByText('Browser draft')).toBeTruthy();
    expect(screen.getByRole('link', { name: /log in to keep them/i })).toHaveAttribute('href', '/login');
  });
});
