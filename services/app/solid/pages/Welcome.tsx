/* @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { internalRedirectTarget } from '@/lib/http/safe-redirect';
import { pageDataChanged, profileChanged } from '@/solid/lib/page-data-events';
import { AvatarCircle } from '../ui/AvatarCircle';
import { replaceDocument } from '../lib/document-navigation';
import { useSession } from '../lib/session';
import { apiFetch } from '../lib/api';
import { FormPage, FORM_INPUT, FORM_PRIMARY_BUTTON } from '../ui/FormControls';

const HANDLE_REFUSALS: Record<string, string> = {
  username_taken: 'that handle is taken — pick another',
  invalid_username: '3–32 characters: lowercase letters, numbers, underscore (no hyphens)',
};

export function WelcomePage(): JSX.Element {
  const { session, reload } = useSession();
  const search = new URLSearchParams(window.location.search);
  const callbackUrl = search.get('callbackUrl');
  const [username, setUsername] = createSignal('');
  const [image, setImage] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  createEffect(() => {
    let alive = true;
    void fetch('/api/my/profile', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null).then((profile: { username: string | null; image: string | null } | null) => {
      if (alive && profile) { setUsername(profile.username ?? ''); setImage(profile.image); }
    }).catch(() => {});
    onCleanup(() => { alive = false; });
  });
  const confirm = async () => {
    setBusy(true); setStatus(null);
    const response = await apiFetch('/api/my/profile', 'PATCH', { username: username(), welcome_pending: false }).catch(() => null);
    setBusy(false);
    if (!response) { setStatus('could not reach the server'); return; }
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setStatus(HANDLE_REFUSALS[body.error ?? ''] ?? 'could not save that handle'); return; }
    setLeaving(true); pageDataChanged(); profileChanged(); reload();
    replaceDocument(internalRedirectTarget(callbackUrl, window.location.origin));
  };
  return <Show when={leaving() || !session() || !!session()?.user} fallback={<Navigate href={`/login?callbackUrl=${encodeURIComponent(`/welcome${search.toString() ? `?${search}` : ''}`)}`} />}>
    <Show when={leaving() || !session()?.onboarded} fallback={<Navigate href="/account" />}>
      <FormPage narrow>
        <h1 class="text-3xl font-semibold tracking-tight text-fg">Welcome to artifactbin</h1>
        <p class="mt-3 text-sm leading-relaxed text-muted">Choose a handle for your profile and the documents you share.</p>
        <div class="mt-6"><AvatarCircle image={image()} initial={username() || 'a'} userId={session()?.user?.id ?? ''} onChange={setImage} /></div>
        <form class="mt-6" onSubmit={event => { event.preventDefault(); void confirm(); }}>
          <label for="welcome-username" class="text-sm font-medium text-fg">Handle</label>
          <div class="mt-2 flex items-center gap-2"><span class="w-4 text-center font-mono text-sm text-muted">@</span><input id="welcome-username" aria-label="Username" autocomplete="off" spellcheck={false} value={username()} onInput={event => setUsername(event.currentTarget.value)} class={`${FORM_INPUT} min-w-0 flex-1`} /></div>
          <Show when={status()}><p role="status" class="mt-2 ml-6 text-sm text-danger">{status()}</p></Show>
          <div class="mt-6"><button type="submit" disabled={busy() || !username().trim()} class={`${FORM_PRIMARY_BUTTON} w-full`}>{busy() ? 'Saving…' : 'Confirm'}</button></div>
        </form>
      </FormPage>
    </Show>
  </Show>;
}
