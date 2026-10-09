/* @jsxImportSource solid-js */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { pageDataChanged, profileChanged } from '@/solid/lib/page-data-events';
import { Button } from './ui';
import { apiFetch } from '../lib/api';

const HANDLE_REFUSALS: Record<string, string> = { username_taken: 'that handle is taken — pick another', invalid_username: '3–32 characters: lowercase letters, numbers, underscore (no hyphens)' };

export function UsernameCard(props: { username: string | null }): JSX.Element {
  const [value, setValue] = createSignal('');
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  createEffect(() => setValue(props.username ?? ''));
  const save = async () => {
    setBusy(true); setStatus(null);
    const response = await apiFetch('/api/my/profile', 'PATCH', { username: value() }).catch(() => null);
    setBusy(false);
    if (!response) { setStatus('could not reach the server'); return; }
    const body = await response.json().catch(() => ({})) as { username?: string; error?: string };
    if (response.ok && body.username) { setValue(body.username); setStatus('saved'); pageDataChanged(); profileChanged(); return; }
    setStatus(HANDLE_REFUSALS[body.error ?? ''] ?? 'could not save that handle');
  };
  return <section class="min-w-0"><label for="profile-username" class="text-sm font-medium">Handle</label>
    <form class="mt-3 flex items-center gap-2" onSubmit={event => { event.preventDefault(); void save(); }}><div class="flex h-9 min-w-0 flex-1 items-center rounded-[4px] border border-edge bg-surface focus-within:border-accent"><span aria-hidden="true" class="pl-3 font-mono text-sm text-faint">@</span><input id="profile-username" aria-label="Username" autocomplete="off" spellcheck={false} value={value()} onInput={event => setValue(event.currentTarget.value)} class="min-w-0 w-full border-0 bg-transparent px-2 py-2 text-sm outline-none" /></div><Button type="submit" aria-label="Save username" disabled={busy() || !value().trim()} class="h-9 shrink-0">Save</Button></form>
    <p class="mt-1 text-xs leading-relaxed text-muted">Renaming is safe: links already shared keep working.</p>
    <Show when={status()}><p role="status" class={`mt-2 text-xs ${status() === 'saved' ? 'text-accent' : 'text-danger'}`}>{status()}</p></Show>
  </section>;
}
