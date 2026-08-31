/**
 * The login form talks to Better Auth's OTP endpoints, served by the proxy:
 * a code is SENT with `send-verification-otp` and VERIFIED with `sign-in/
 * email-otp`; a refused code is a recoverable error on the same screen; a good
 * one redirects only to an internal target.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginForm from '../LoginForm';

let requests: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
let verifyStatus = 401;

beforeEach(() => {
  requests = [];
  verifyStatus = 401; // stay on the page; no jsdom navigation
  vi.stubGlobal('fetch', (async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init.body)), headers: (init.headers ?? {}) as Record<string, string> });
    const status = String(url).endsWith('/sign-in/email-otp') ? verifyStatus : 200;
    return new Response(JSON.stringify(status === 200 ? { ok: true } : { message: 'INVALID_OTP' }), { status });
  }) as unknown as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

const emailField = () => screen.getByLabelText('Email') as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const click = (label: string) => fireEvent.click(screen.getByLabelText(label));

describe('step one — the email', () => {
  it('asks for an email and nothing else (there is no password field)', () => {
    render(<LoginForm />);
    expect(emailField()).toBeTruthy();
    expect(screen.getByLabelText('Log in with email')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
  it('requests a code for the typed address from the OTP door', async () => {
    render(<LoginForm />);
    type(emailField(), 'v@minusx.ai');
    click('Log in with email');
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].url).toBe('/api/auth/email-otp/send-verification-otp');
    expect(requests[0].body).toEqual({ email: 'v@minusx.ai', type: 'sign-in' });
    expect(requests[0].headers['x-invite-code']).toBeUndefined();
  });
});

describe('step two — the code', () => {
  const reachCodeScreen = async (address = 'v@minusx.ai') => {
    render(<LoginForm />);
    type(emailField(), address);
    click('Log in with email');
    await screen.findByLabelText('Login code');
  };
  it('swaps to the code screen and shows which address it went to', async () => {
    await reachCodeScreen();
    expect(screen.getByLabelText('Login code')).toBeTruthy();
    expect(screen.getByText('v@minusx.ai')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
  it('verifies the email and code together', async () => {
    await reachCodeScreen();
    type(screen.getByLabelText('Login code'), '123456');
    click('Verify code');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].url).toBe('/api/auth/sign-in/email-otp');
    expect(requests[1].body).toEqual({ email: 'v@minusx.ai', otp: '123456' });
  });
  it('shows a recoverable error on a bad code, staying on the code screen', async () => {
    await reachCodeScreen();
    type(screen.getByLabelText('Login code'), '000000');
    click('Verify code');
    await screen.findByText(/isn’t right/);
    expect(screen.getByLabelText('Login code')).toBeTruthy();
  });
  it('resends to the same address without leaving the screen', async () => {
    await reachCodeScreen();
    click('Resend code');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toEqual({ email: 'v@minusx.ai', type: 'sign-in' });
    expect(screen.getByLabelText('Login code')).toBeTruthy();
  });
});

describe('change email — the typo escape hatch', () => {
  it('goes back to an EDITABLE address field, prefilled, and can send to the new one', async () => {
    render(<LoginForm />);
    type(emailField(), 'typo@minsux.ai');
    click('Log in with email');
    await screen.findByLabelText('Login code');
    click('Change email');
    expect(emailField().value).toBe('typo@minsux.ai');
    type(emailField(), 'right@minusx.ai');
    click('Log in with email');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body).toEqual({ email: 'right@minusx.ai', type: 'sign-in' });
  });
});

describe('after a good code', () => {
  it('redirects only to an internal target — a callbackUrl off-origin is refused', async () => {
    verifyStatus = 200;
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, search: '?callbackUrl=https://evil.example/x', origin: 'http://localhost:3000', set href(v: string) { assign(v); } } });
    try {
      render(<LoginForm />);
      type(emailField(), 'v@minusx.ai');
      click('Log in with email');
      await screen.findByLabelText('Login code');
      type(screen.getByLabelText('Login code'), '123456');
      click('Verify code');
      await waitFor(() => expect(assign).toHaveBeenCalled());
      expect(String(assign.mock.calls[0][0])).not.toContain('evil.example');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
