/* @jsxImportSource solid-js */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { loginRedirectTarget, internalRedirectTarget } from '@/lib/http/safe-redirect';
import { useSession } from '../lib/session';
import { apiFetch } from '../lib/api';

import { FormPage, FORM_INPUT as INPUT, FORM_PRIMARY_BUTTON as BUTTON } from '../components/FormControls';

export function LoginPage(): JSX.Element {
  const { session, sessionError } = useSession();
  const [email, setEmail] = createSignal('');
  const [code, setCode] = createSignal('');
  const [sent, setSent] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  createEffect(() => {
    if (session()?.user) window.location.replace(loginRedirectTarget(new URLSearchParams(window.location.search).get('callbackUrl'), window.location.origin));
  });
  const requestCode = async () => {
    setBusy(true); setError(null);
    try {
      const response = await apiFetch('/api/auth/email-otp/send-verification-otp', 'POST', { email: email(), type: 'sign-in' });
      if (response.ok) { setSent(true); setCode(''); }
      else { const body = await response.json().catch(() => ({})); setError(body.error === 'rate_limited' ? 'Too many codes requested. Try again in a bit.' : 'That email address doesn’t look right.'); }
    } catch { setError('Couldn’t reach the server. Try again.'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    const response = await apiFetch('/api/auth/sign-in/email-otp', 'POST', { email: email(), otp: code() }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setError('That code isn’t right, or it expired. Request a new one.'); return; }
    window.location.href = internalRedirectTarget(new URLSearchParams(window.location.search).get('callbackUrl'), window.location.origin);
  };
  return <Show when={!session()?.user && (session() || sessionError())}>
    <FormPage narrow>
      <h1 class="text-base font-semibold"><span class="text-accent">&gt;</span> log in</h1>
      <Show when={!sent()} fallback={<>
        <p class="mt-2 text-xs text-muted">We emailed a code to <span class="text-fg">{email()}</span>. It expires in 10 minutes.</p>
        <form class="mt-5 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void verify(); }}>
          <input type="text" autofocus inputMode="numeric" autocomplete="one-time-code" maxLength={6} aria-label="Login code" placeholder="6-digit code" value={code()} onInput={event => setCode(event.currentTarget.value)} class={INPUT} />
          <button type="submit" aria-label="Verify code" disabled={busy() || !code()} class={BUTTON}>{busy() ? 'checking…' : 'log in'}</button>
        </form>
        <div class="mt-4 flex items-center justify-between text-xs text-muted"><button type="button" aria-label="Change email" class="cursor-pointer underline hover:text-accent" onClick={() => { setSent(false); setCode(''); setError(null); }}>change email</button><button type="button" aria-label="Resend code" class="cursor-pointer underline hover:text-accent" disabled={busy()} onClick={() => void requestCode()}>resend code</button></div>
      </>}>
        <p class="mt-2 text-xs text-muted">We’ll email you a 6-digit code. No password to remember.</p>
        <form class="mt-5 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void requestCode(); }}>
          <input type="email" autofocus autocomplete="email" aria-label="Email" placeholder="email" value={email()} onInput={event => setEmail(event.currentTarget.value)} class={INPUT} />
          <button type="submit" aria-label="Log in with email" disabled={busy() || !email()} class={BUTTON}>{busy() ? 'sending…' : 'log in with email'}</button>
        </form>
        <p class="mt-10 text-xs text-muted"><b>Note:</b> Your guest artifacts and connected agents will join this account.</p>
      </Show>
      <Show when={error()}><p class="mt-3 text-xs text-danger">{error()}</p></Show>
    </FormPage>
  </Show>;
}
