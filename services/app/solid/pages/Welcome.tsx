/* @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { internalRedirectTarget } from '@/lib/http/safe-redirect';
import { pageDataChanged, profileChanged } from '@/web/page-data-events';
import { AvatarCircle } from '../components/AvatarCircle';
import { replaceDocument } from '../lib/document-navigation';
import { useSession } from '../lib/session';
import { apiFetch } from '../lib/api';

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
      <main class="mx-auto mt-16 max-w-xl px-6"><div class="mx-auto max-w-sm">
        <h1 class="text-base font-semibold"><span class="text-accent">&gt;</span> welcome</h1>
        <div class="mt-6"><AvatarCircle image={image()} initial={username() || 'a'} userId={session()?.user?.id ?? ''} onChange={setImage} /></div>
        <form class="mt-6" onSubmit={event => { event.preventDefault(); void confirm(); }}>
          <label for="welcome-username" class="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">handle</label>
          <div class="mt-2 flex items-center gap-2"><span class="w-4 text-center font-mono text-sm text-muted">@</span><input id="welcome-username" aria-label="Username" autocomplete="off" spellcheck={false} value={username()} onInput={event => setUsername(event.currentTarget.value)} class="min-w-0 flex-1 rounded-[4px] border border-edge bg-surface px-3 py-2 text-sm" /></div>
          <Show when={status()}><p role="status" class="mt-2 ml-6 font-mono text-xs text-danger">{status()}</p></Show>
          <div class="mt-6"><button type="submit" disabled={busy() || !username().trim()} class="rounded-[4px] border border-fg bg-fg px-3 py-1.5 font-mono text-xs font-semibold text-bg">Confirm</button></div>
        </form>
      </div></main>
    </Show>
  </Show>;
}
