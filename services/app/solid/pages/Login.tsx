/* @jsxImportSource solid-js */
import { createEffect, createSignal, Show, untrack, type JSX } from 'solid-js';
import { loginRedirectTarget } from '@/lib/http/safe-redirect';
import { useSession } from '../lib/session';
import { apiFetch } from '../lib/api';
import { replaceDocument } from '../lib/document-navigation';
import { CODE_DELIVERY_HEADER, codeDeliveryOf, type CodeDelivery } from '@artifactbin/contracts';

import { FormPage } from '../ui/PageHeader';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';

/** Email and the sent flag (never the code) survive a reload, e.g. an in-app browser that reloads on app switch. */
function readProgress(progressKey: string): { email: string; sent: boolean; delivery?: CodeDelivery } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(progressKey) ?? 'null') as { email?: unknown; sent?: unknown; delivery?: unknown } | null;
    if (saved && typeof saved.email === 'string' && saved.email) return { email: saved.email, sent: saved.sent === true, delivery: codeDeliveryOf(saved.delivery) };
  } catch { /* storage unavailable or malformed: start fresh */ }
  return { email: '', sent: false };
}
function writeProgress(progressKey: string, email: string, sent: boolean, delivery?: CodeDelivery) {
  try {
    if (sent) sessionStorage.setItem(progressKey, JSON.stringify({ email, sent, delivery }));
    else sessionStorage.removeItem(progressKey);
  } catch { /* storage unavailable */ }
}

export function LoginPage(props:{onAuthenticated?:()=>void;callbackUrl?:string|null;}={}): JSX.Element {
  const { session, sessionError } = useSession();
  const callbackUrl = props.callbackUrl === undefined ? new URLSearchParams(window.location.search).get('callbackUrl') : props.callbackUrl;
  const destination = loginRedirectTarget(callbackUrl, window.location.origin);
  const progressKey = `afbin:login:${callbackUrl ?? ''}`;
  const saved = readProgress(progressKey);
  const [email, setEmail] = createSignal(saved.email);
  const [code, setCode] = createSignal('');
  const [sent, setSent] = createSignal(saved.sent);
  const [delivery, setDelivery] = createSignal(saved.delivery);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  createEffect(() => {
    if (session()?.user) {
      if(props.onAuthenticated)untrack(props.onAuthenticated);
      else replaceDocument(destination);
    }
  });
  const requestCode = async () => {
    setBusy(true); setError(null);
    try {
      const response = await apiFetch('/api/auth/email-otp/send-verification-otp', 'POST', { email: email(), type: 'sign-in' });
      if (response.ok) { const mode = codeDeliveryOf(response.headers.get(CODE_DELIVERY_HEADER)); setDelivery(mode); setSent(true); setCode(''); writeProgress(progressKey, email(), true, mode); }
      else { const body = await response.json().catch(() => ({})); setError(body.error === 'rate_limited' ? 'Too many codes requested. Try again in a bit.' : 'That email address doesn’t look right.'); }
    } catch { setError('Couldn’t reach the server. Try again.'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    try {
      const response = await apiFetch('/api/auth/sign-in/email-otp', 'POST', { email: email(), otp: code() });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        setError(response.status === 403 && body?.error === 'deployment_admission_required'
          ? 'This company requires an invitation. Ask its operator to invite this email, confirm company setup, and check the allowed email policy.'
          : response.status >= 500
          ? 'The server is temporarily unavailable. Your code is still here; try again.'
          : 'That code isn’t right, or it expired. Request a new one.');
        return;
      }
    } catch {
      setError('Couldn’t reach the server. Your code is still here; try again.');
      return;
    } finally {
      setBusy(false);
    }
    writeProgress(progressKey, '', false);
    if(props.onAuthenticated)props.onAuthenticated();
    else replaceDocument(destination);
  };
  return <Show when={!session()?.user && (session() || sessionError())}>
    <FormPage narrow>
      <Show when={!sent()} fallback={<>
        <PageHeader title="Log in to artifactbin" description={<>{delivery() === 'email' ? 'We emailed a code to ' : 'A login code was generated for '}<span class="text-fg">{email()}</span>. It expires in 10 minutes.<Show when={delivery() === 'operator_outbox'}> Ask the server operator for the code from the protected local outbox or server output.</Show></>} />
        <form class="mt-6 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void verify(); }}>
          <Field label="Verification code"><Input type="text" autofocus inputMode="numeric" autocomplete="one-time-code" maxLength={6} aria-label="Login code" placeholder="6-digit code" value={code()} onInput={event => setCode(event.currentTarget.value)} /></Field>
          <Button type="submit" aria-label="Verify code" disabled={busy() || !code()}>{busy() ? 'Checking…' : 'Log in'}</Button>
        </form>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted"><Button variant="link" type="button" aria-label="Change email" class="min-h-11" onClick={() => { setSent(false); setCode(''); setError(null); writeProgress(progressKey, '', false); }}>Change email</Button><Button variant="link" type="button" aria-label="Resend code" class="min-h-11" disabled={busy()} onClick={() => void requestCode()}>Resend code</Button></div>
      </>}>
        <PageHeader title="Log in to artifactbin" description="Request a 6-digit login code. No password to remember." />
        <form class="mt-6 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void requestCode(); }}>
          <Field label="Email address"><Input type="email" autofocus autocomplete="email" aria-label="Email" placeholder="you@example.com" value={email()} onInput={event => setEmail(event.currentTarget.value)} /></Field>
          <Button type="submit" aria-label="Log in with email" disabled={busy() || !email()}>{busy() ? 'Sending…' : 'Log in with email'}</Button>
        </form>
        <p class="mt-6 border-t border-edge pt-5 text-sm leading-relaxed text-muted">Previously saved guest artifacts and connected agents will join this account.</p>
      </Show>
      <Show when={error()}><StatusMessage kind="error" class="mt-4">{error()}</StatusMessage></Show>
    </FormPage>
  </Show>;
}
