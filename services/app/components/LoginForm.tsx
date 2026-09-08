'use client';

import {appFetch as fetch, appNavigate} from '@/web/api-origin';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { internalRedirectTarget } from '@/lib/safe-redirect';
import {useSession} from '@/web/session';

/**
 * One form for logging in AND signing up, because with emailed codes they are
 * the same act: prove you can read the address and you have an account.
 *
 * Two steps, one component — `sent` is the entire state machine. Step two can
 * always go back and correct the address, which is the difference between a
 * typo costing five seconds and costing a support email.
 */
export default function LoginForm() {
  const {refreshAuth} = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticated,setAuthenticated] = useState(false);

  const requestCode = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, type: 'sign-in' }),
      });
      if (res.ok) {
        setSent(true);
        setCode('');
      } else {
        const body = await res.json().catch(() => ({}));
        setError(
          body.error === 'rate_limited'
            ? 'Too many codes requested. Try again in a bit.'
            : 'That email address doesn’t look right.',
        );
      }
    } catch {
      setError('Couldn’t reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <>
        <p className="mt-2 text-xs text-muted">We’ll email you a 6-digit code. No password to remember.</p>
        <form
          className="mt-5 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode(email);
          }}
        >
          <Input
            type="email"
            autoFocus
            autoComplete="email"
            aria-label="Email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" aria-label="Log in with email" disabled={busy || email.length === 0}>
            {busy ? 'sending…' : 'log in with email'}
          </Button>
        </form>
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      </>
    );
  }

  return (
    <>
      <p className="mt-2 text-xs text-muted">
        We emailed a code to <span className="text-fg">{email}</span>. It expires in 10 minutes.
      </p>
      <form
        className="mt-5 flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = authenticated ? null : await fetch('/api/auth/sign-in/email-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp: code }),
          }).catch(() => null);
          setBusy(false);
          if (!authenticated && (!res || !res.ok)) {
            setError('That code isn’t right, or it expired. Request a new one.');
            return;
          }
          setAuthenticated(true);
          if (!await refreshAuth()) {
            setError('Logged in, but your session could not be verified. Retry below; your code has already been accepted.');
            return;
          }
          // callbackUrl is attacker-controllable; internalRedirectTarget refuses
          // anything that resolves off-origin (including `//evil.com`).
          const callbackUrl = new URLSearchParams(window.location.search).get('callbackUrl');
          appNavigate(internalRedirectTarget(callbackUrl, window.location.origin),true);
        }}
      >
        <Input
          type="text"
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-label="Login code"
          placeholder="6-digit code"
          value={code}
          disabled={authenticated}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" aria-label={authenticated?'Retry loading session':'Verify code'} disabled={busy || code.length === 0}>
          {busy ? 'checking…' : authenticated ? 'retry session' : 'log in'}
        </Button>
      </form>
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <button
          type="button"
          aria-label="Change email"
          disabled={busy || authenticated}
          className="cursor-pointer underline hover:text-accent"
          onClick={() => {
            setSent(false);
            setCode('');
            setError(null);
          }}
        >
          change email
        </button>
        <button
          type="button"
          aria-label="Resend code"
          className="cursor-pointer underline hover:text-accent"
          disabled={busy || authenticated}
          onClick={() => void requestCode(email)}
        >
          resend code
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </>
  );
}
