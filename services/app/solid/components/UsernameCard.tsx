/* @jsxImportSource solid-js */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { pageDataChanged, profileChanged } from '@/web/page-data-events';
import { PANEL, MicroLabel } from './ui';

export const HANDLE_REFUSALS: Record<string, string> = { username_taken: 'that handle is taken — pick another', invalid_username: '3–32 characters: lowercase letters, numbers, underscore (no hyphens)' };

export function UsernameCard(props: { username: string | null }): JSX.Element {
  const [value, setValue] = createSignal('');
  const [status, setStatus] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  createEffect(() => setValue(props.username ?? ''));
  const save = async () => {
    setBusy(true); setStatus(null);
    const response = await fetch('/api/my/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: value() }) }).catch(() => null);
    setBusy(false);
    if (!response) { setStatus('could not reach the server'); return; }
    const body = await response.json().catch(() => ({})) as { username?: string; error?: string };
    if (response.ok && body.username) { setValue(body.username); setStatus('saved'); pageDataChanged(); profileChanged(); return; }
    setStatus(HANDLE_REFUSALS[body.error ?? ''] ?? 'could not save that handle');
  };
  return <section class={`${PANEL} p-4`}><MicroLabel>handle</MicroLabel>
    <form class="mt-2 flex items-center gap-2" onSubmit={event => { event.preventDefault(); void save(); }}><span class="w-4 text-center font-mono text-sm text-muted">@</span><span class="min-w-0 flex-1 sm:max-w-72"><input aria-label="Username" autocomplete="off" spellcheck={false} value={value()} onInput={event => setValue(event.currentTarget.value)} class="w-full rounded-[4px] border border-edge bg-surface px-3 py-2 text-sm" /></span><button type="submit" aria-label="Save username" disabled={busy() || !value().trim()} class="rounded-[4px] border border-fg bg-fg px-3 py-1.5 font-mono text-xs font-semibold text-bg">save</button></form>
    <p class="mt-2 ml-6 font-mono text-[11px] text-faint">your documents live at <span class="text-muted">/@{value() || 'handle'}/…</span></p>
    <p class="mt-1 ml-6 font-mono text-xs leading-relaxed text-muted">Renaming is safe: links already shared keep working — every URL resolves by the document’s id and corrects itself to the new handle.</p>
    <Show when={status()}><p role="status" class={`mt-2 ml-6 font-mono text-xs ${status() === 'saved' ? 'text-accent' : 'text-danger'}`}>{status()}</p></Show>
  </section>;
}
