/**
 * The menu's session control has THREE states, because a browser can hold a
 * credential three ways:
 *
 *  - an account session  → "Sign out" (Better Auth)
 *  - an anonymous session → "Disconnect this browser" (clears the agent cookie;
 *    account sign-out is not involved when there is no account, and would leave
 *    the cookie in place, which is exactly the bug this pins)
 *  - neither              → "Log in"
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const signOut = vi.fn();
const forgetTokens = vi.fn();
vi.mock('@/lib/browser-session', () => ({ forgetTokens: () => forgetTokens() }));

import { PageMenu } from '../PageChrome';

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  forgetTokens.mockReset();
  forgetTokens.mockResolvedValue(undefined);
});

const openMenu = () => fireEvent.click(screen.getByLabelText('Open menu'));

describe('the session control', () => {
  it('an account session gets Sign out — and nothing else', () => {
    render(<PageMenu authed />);
    openMenu();
    expect(screen.getByLabelText('Sign out')).toBeInTheDocument();
    expect(screen.queryByLabelText('Disconnect this browser')).toBeNull();
    expect(screen.queryByLabelText('Login')).toBeNull();
  });

  it('an anonymous session gets Disconnect — never account Sign out', () => {
    render(<PageMenu authed={false} anon />);
    openMenu();
    expect(screen.getByLabelText('Disconnect this browser')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sign out')).toBeNull();
  });

  it('Disconnect clears the agent cookie and does NOT sign out an account', async () => {
    render(<PageMenu authed={false} anon />);
    openMenu();
    fireEvent.click(screen.getByLabelText('Disconnect this browser'));
    expect(forgetTokens).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('an account session that ALSO holds an anon cookie still gets account Sign out', () => {
    // Account wins — it is the wider identity, and Better Auth owns its cookie.
    render(<PageMenu authed anon />);
    openMenu();
    expect(screen.getByLabelText('Sign out')).toBeInTheDocument();
    expect(screen.queryByLabelText('Disconnect this browser')).toBeNull();
  });

  it('no credential offers Log in', () => {
    render(<PageMenu authed={false} />);
    openMenu();
    expect(screen.getByLabelText('Login')).toBeInTheDocument();
    expect(screen.queryByLabelText('Disconnect this browser')).toBeNull();
  });
});

/**
 * Sign out is a POST to the PROXY's sign-out (Better Auth's `/api/auth/sign-out`)
 * and then a navigation the top bar performs ITSELF, to `/`. Nothing computes
 * a redirect from request headers on our behalf — the reason the old NextAuth
 * `callbackUrl` shape was refused still holds: a redirect target that a
 * library derives from headers is a redirect target an attacker can shape.
 */
describe('the sign-out request', () => {
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
});
