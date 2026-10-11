/* @jsxImportSource solid-js */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { pageDataChanged, profileChanged } from '@/solid/lib/page-data-events';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { StatusMessage } from '../ui/StatusMessage';
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
  return <section class="min-w-0">
    <form onSubmit={event => { event.preventDefault(); void save(); }}><Field label="Handle" hint="Renaming is safe: links already shared keep working.">
      <div class="flex items-center gap-2"><span aria-hidden="true" class="w-4 text-center font-mono text-sm text-faint">@</span><Input aria-label="Username" autocomplete="off" spellcheck={false} value={value()} onInput={event => setValue(event.currentTarget.value)} class="min-w-0 flex-1" /><Button type="submit" aria-label="Save username" disabled={busy() || !value().trim()}>{busy() ? 'Saving…' : 'Save'}</Button></div>
    </Field></form>
    <Show when={status()}><StatusMessage kind={status() === 'saved' ? 'notice' : 'error'} class="mt-2">{status()}</StatusMessage></Show>
  </section>;
}
