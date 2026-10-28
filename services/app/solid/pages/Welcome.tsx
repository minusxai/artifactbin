/* @jsxImportSource solid-js */
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { internalRedirectTarget } from '@/lib/http/safe-redirect';
import { pageDataChanged, profileChanged } from '@/solid/lib/page-data-events';
import { AvatarCircle } from '../ui/AvatarCircle';
import { replaceDocument } from '../lib/document-navigation';
import { useSession } from '../lib/session';
import { apiFetch } from '../lib/api';
import { FormPage } from '../ui/PageHeader';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';

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
    void retryingFetch('/api/my/profile', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null).then((profile: { username: string | null; image: string | null } | null) => {
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
        <PageHeader title="Welcome to artifactbin" description="Choose a handle for your profile and the documents you share." />
        <div class="mt-6"><AvatarCircle image={image()} initial={username() || 'a'} userId={session()?.user?.id ?? ''} onChange={setImage} /></div>
        <form class="mt-6" onSubmit={event => { event.preventDefault(); void confirm(); }}>
          <Field label="Handle">
            <div class="flex items-center gap-2"><span class="w-4 text-center font-mono text-sm text-muted">@</span><Input aria-label="Username" autocomplete="off" spellcheck={false} value={username()} onInput={event => setUsername(event.currentTarget.value)} class="min-w-0 flex-1" /></div>
          </Field>
          <Show when={status()}><StatusMessage kind="error" class="mt-2 ml-6">{status()}</StatusMessage></Show>
          <div class="mt-6"><Button type="submit" disabled={busy() || !username().trim()} class="w-full">{busy() ? 'Saving…' : 'Confirm'}</Button></div>
        </form>
      </FormPage>
    </Show>
  </Show>;
}
