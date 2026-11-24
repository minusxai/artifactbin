/* @jsxImportSource solid-js */
import {handleInputError} from '../lib/handle-input';
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { pageDataChanged, profileChanged } from '@/solid/lib/page-data-events';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { StatusMessage } from '../ui/StatusMessage';
import { apiFetch } from '../lib/api';

const HANDLE_REFUSALS: Record<string, string> = { managed_username: 'Your sign-in provider manages this handle.', username_taken: 'that handle is taken — pick another', invalid_username: '3–32 characters: lowercase letters, numbers, single internal underscores (no hyphens)' };

export function UsernameCard(props: { managed?: boolean; name?: string | null; username: string | null }): JSX.Element {
  const [value, setValue] = createSignal('');
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  createEffect(() => setValue(props.username ?? ''));
  const [name, setName] = createSignal('');
  createEffect(() => setName(props.name ?? ''));
  const saveName = async () => {
    setBusy(true);
    setStatus(null);
    const response = await apiFetch('/api/my/profile', 'PATCH', {name:name()}).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setStatus('Could not save the display name.'); return; }
    setName(name().trim());
    setStatus('saved');
    pageDataChanged();
    profileChanged();
  };
  const save = async () => {
    if (handleInputError(value())) return;
    setBusy(true); setStatus(null);
    const response = await apiFetch('/api/my/profile', 'PATCH', { username: value() }).catch(() => null);
    setBusy(false);
    if (!response) { setStatus('could not reach the server'); return; }
    const body = await response.json().catch(() => ({})) as { username?: string; error?: string };
    if (response.ok && body.username) { setValue(body.username); setStatus('saved'); pageDataChanged(); profileChanged(); return; }
    setStatus(HANDLE_REFUSALS[body.error ?? ''] ?? 'could not save that handle');
  };
  return <section class="min-w-0">
    <form class="mb-4" onSubmit={event => { event.preventDefault(); void saveName(); }}>
      <Field label="Display name"><div class="flex items-center gap-2">
        <Input autocomplete="name" maxLength={200} value={name()} onInput={event => setName(event.currentTarget.value)} />
        <Button type="submit" aria-label="Save display name" disabled={busy() || !name().trim()}>Save</Button>
      </div></Field>
    </form>
    <Show when={!props.managed} fallback={<div><p>Handle</p><p>@{props.username}</p><p class="text-sm text-muted">Your sign-in provider manages this handle.</p></div>}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}><Field label="Handle" error={value() ? handleInputError(value()) : undefined} hint="Renaming is safe: links already shared keep working.">
      <div class="flex items-center gap-2"><span aria-hidden="true" class="w-4 text-center font-mono text-sm text-faint">@</span><Input aria-label="Username" autocomplete="off" spellcheck={false} value={value()} onInput={event => setValue(event.currentTarget.value)} class="min-w-0 flex-1" /><Button type="submit" aria-label="Save username" disabled={busy() || !!handleInputError(value())}>{busy() ? 'Saving…' : 'Save'}</Button></div>
    </Field></form>
    </Show>
    <Show when={status()}><StatusMessage kind={status() === 'saved' ? 'notice' : 'error'} class="mt-2">{status()}</StatusMessage></Show>
  </section>;
}
