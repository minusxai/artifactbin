/**
 * The menu's session control has THREE states, because a browser can hold a
 * credential three ways:
 *
 *  - an account session  → "Sign out" (NextAuth)
 *  - an anonymous session → "Disconnect this browser" (clears the agent cookie;
 *    NextAuth's signOut is a no-op here — there is no account — and would leave
 *    the cookie in place, which is exactly the bug this pins)
 *  - neither              → "Log in"
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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

  it('Disconnect clears the agent cookie and does NOT call NextAuth', async () => {
    render(<PageMenu authed={false} anon />);
    openMenu();
    fireEvent.click(screen.getByLabelText('Disconnect this browser'));
    expect(forgetTokens).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('an account session that ALSO holds an anon cookie still gets account Sign out', () => {
    // Account wins — it is the wider identity, and NextAuth owns its cookie.
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
