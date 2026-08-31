/**
 * Sign out is a POST to the PROXY's sign-out (Better Auth's `/api/auth/sign-out`)
 * and then a navigation the top bar performs ITSELF, to `/`. Nothing computes
 * a redirect from request headers on our behalf — the reason the old NextAuth
 * `callbackUrl` shape was refused still holds: a redirect target that a
 * library derives from headers is a redirect target an attacker can shape.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PageMenu } from '../PageChrome';

let posted: Array<{ url: string; method?: string; contentType?: string }> = [];
let assigned: string[] = [];
const original = window.location;

beforeEach(() => {
  posted = []; assigned = [];
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => { posted.push({ url: String(url), method: init?.method, contentType: (init?.headers as Record<string, string> | undefined)?.['Content-Type'] }); return new Response('{}'); }) as unknown as typeof fetch);
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, set href(v: string) { assigned.push(v); } } });
});
afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(window, 'location', { configurable: true, value: original }); });

describe('sign out', () => {
  it('posts to the proxy and navigates home itself — no library computes the redirect', async () => {
    render(<PageMenu title="x" authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    fireEvent.click(screen.getByLabelText('Sign out'));
    await waitFor(() => expect(assigned).toEqual(['/']));
    // Better Auth answers 415 to a bodiless POST: the request is JSON, or the session survives the click.
    expect(posted).toEqual([{ url: '/api/auth/sign-out', method: 'POST', contentType: 'application/json' }]);
  });
});
