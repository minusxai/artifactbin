/**
 * `refresh()` re-reads, it does not reload. Under Next it refetched the
 * server components in place; the naive translation (`navigate(0)`) reloads
 * the page and destroys exactly the local state the caller had just set (the
 * claim banner's result — measured: it never painted). These pin the
 * replacement: the event re-fetches the pages' data, and nothing navigates.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { REFRESH_EVENT } from '@/lib/navigation';
import { SessionProvider, useSession } from '@/web/session';
import { HomePage } from '@/web/pages/Home';

let fetches: string[] = [];
const answer = (url: string) => {
  if (url.includes('/api/page/session')) return { user: { id: 'usr_1', email: 'a@example.com' }, kind: 'account', stats: null, mixpanel: { token: null, host: '' } };
  if (url.includes('/api/page/home')) return { signedIn: true, artifacts: [], shared: [] };
  return {};
};

beforeEach(() => {
  fetches = [];
  vi.stubGlobal('fetch', (async (url: string) => { fetches.push(String(url)); return new Response(JSON.stringify(answer(String(url))), { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

const Probe = () => { const { session } = useSession(); return <p>{session ? 'session loaded' : 'loading'}</p>; };

describe('the refresh event', () => {
  it('re-reads the session and the page, without navigating', async () => {
    const before = window.location.href;
    render(<MemoryRouter><SessionProvider><Probe /><HomePage /></SessionProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('session loaded')).toBeTruthy());
    const first = fetches.length;
    expect(fetches.some((u) => u.includes('/api/page/home'))).toBe(true);

    await act(async () => { window.dispatchEvent(new Event(REFRESH_EVENT)); });
    await waitFor(() => expect(fetches.length).toBeGreaterThan(first));
    expect(fetches.filter((u) => u.includes('/api/page/session')).length).toBeGreaterThan(1);
    expect(fetches.filter((u) => u.includes('/api/page/home')).length).toBeGreaterThan(1);
    expect(window.location.href, 'a refresh must never navigate — that is what destroyed the caller\'s state').toBe(before);
  });
});
