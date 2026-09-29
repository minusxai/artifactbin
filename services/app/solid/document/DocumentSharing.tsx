/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { SHARE_ROLES, SHARE_ROLE_LABEL, type ShareEntry, type ShareRole } from '@/lib/share-roles';
import type { SharingPatch, Visibility } from '@/lib/artifacts';
import type { SharingVerdict } from '@/lib/visibility-icons';

interface SharingState {
  visibility: Visibility; linkRole: ShareRole; shares: ShareEntry[]; canPrivate?: boolean;
}

function RolePicker(props: { label: string; value: ShareRole; onChange: (role: ShareRole) => void }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return <span class="relative inline-block w-32 shrink-0">
    <button type="button" aria-label={props.label} aria-expanded={open()} onClick={() => setOpen(value => !value)} class="w-full rounded border border-edge bg-surface px-2 py-1 text-left">{SHARE_ROLE_LABEL[props.value]}</button>
    <Show when={open()}><span role="listbox" aria-label={props.label} class="absolute right-0 top-full z-[110] w-full rounded border border-edge bg-surface p-1 shadow-xl">
      <For each={SHARE_ROLES}>{role => <button type="button" role="option" aria-selected={props.value === role} onClick={() => { setOpen(false); props.onChange(role); }} class="block w-full rounded p-1 text-left hover:bg-raised">{SHARE_ROLE_LABEL[role]}</button>}</For>
    </span></Show>
  </span>;
}

/** The document sharing door owns dialog state and sends one field per PATCH-shaped PUT. */
export function DocumentSharing(props: {
  id: string; title: string; owner: boolean; editable?: boolean; url?: string;
  variant?: 'chip' | 'menu' | 'dialog'; onClose?: () => void;
  onSharingChange?: (verdict: SharingVerdict) => void;
}): JSX.Element {
  const canManage = () => props.owner || Boolean(props.editable);
  const [open, setOpen] = createSignal(props.variant === 'dialog');
  const [state, setState] = createSignal<SharingState | null>(null);
  const [email, setEmail] = createSignal('');
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const endpoint = `/api/my/artifacts/${encodeURIComponent(props.id)}/sharing`;
  const close = () => { setOpen(false); props.onClose?.(); };
  const copy = () => {
    const target = new URL(props.url ?? `/a/${encodeURIComponent(props.id)}`, location.origin);
    void navigator.clipboard?.writeText(target.origin + target.pathname);
    setCopied(true);
  };
  const put = async (patch: SharingPatch) => {
    setError('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error('could not update sharing');
      setState(await response.json() as SharingState);
    } catch { setError('could not update sharing'); }
  };
  onMount(() => {
    if (!canManage()) return;
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('could not load sharing');
      setState(await response.json() as SharingState);
    }).catch(() => { if (!controller.signal.aborted) setError('could not load sharing'); });
    onCleanup(() => controller.abort());
  });
  createEffect(() => {
    const current = state();
    if (current) props.onSharingChange?.({ visibility: current.visibility, hasInvitedUsers: current.shares.length > 0 });
  });
  createEffect(() => {
    if (!open()) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    window.addEventListener('keydown', escape);
    onCleanup(() => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); });
  });
  return <>
    <Show when={props.variant !== 'dialog'}>
      <button type="button" aria-label="Share" onClick={() => canManage() ? setOpen(true) : copy()} class={props.variant === 'menu' ? 'flex w-full px-2 py-2 text-left font-mono text-xs text-muted hover:bg-raised' : 'rounded border border-edge px-2 py-1 text-xs'}>
        {copied() ? 'copied' : state() ? `share: ${state()!.visibility}` : 'Share'}
      </button>
    </Show>
    <Show when={open()}><Portal><div class="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-8">
      <button type="button" aria-label="Close sharing by clicking outside" onClick={close} class="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <section role="dialog" aria-modal="true" aria-label="Sharing" class="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-[9px] border border-edge-bright bg-surface font-mono text-xs shadow-2xl" style={{ 'max-height': 'calc(100svh - 24px)' }}>
        <header class="flex items-start gap-4 border-b border-edge px-4 py-4 sm:px-6"><div class="min-w-0 flex-1"><h2 class="break-words text-base font-semibold">Share “{props.title}”</h2><p class="mt-1 text-faint">Manage access, invite people, or copy the link.</p></div><button type="button" aria-label="Close sharing" onClick={close}>×</button></header>
        <div class="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <button type="button" aria-label="Copy link" onClick={copy} class="mb-4 w-full rounded border border-edge bg-raised px-3 py-2.5">{copied() ? 'copied' : 'copy link'}</button>
          <Show when={error()}><p role="alert" class="text-danger">{error()}</p></Show>
          <Show when={!state() && !error()}><p role="status">loading…</p></Show>
          <Show when={state()}>{current => <>
            <div class="flex gap-1"><For each={(['public', 'unlisted', 'private'] as const).filter(value => value !== 'private' || current().canPrivate !== false)}>{visibility =>
              <button type="button" aria-label={`Make ${visibility}`} aria-pressed={current().visibility === visibility} onClick={() => void put({ visibility })} class="flex-1 whitespace-nowrap rounded border border-edge px-2 py-2.5 aria-pressed:border-accent">{visibility}</button>
            }</For></div>
            <Show when={current().visibility !== 'private'}><div class="mt-2 flex items-center justify-between gap-2"><span>Anyone with the link</span><RolePicker label="Link role" value={current().linkRole ?? 'viewer'} onChange={role => void put({ linkRole: role })} /></div></Show>
            <section class="mt-5 border-t border-edge pt-4" aria-label="People"><h3 class="mb-1 uppercase tracking-wider text-faint">People</h3>
              <For each={current().shares}>{person => <div class="flex items-center justify-between gap-2 py-0.5"><span class="min-w-0 truncate">{person.email}</span><div class="flex items-center gap-1"><RolePicker label={`Role for ${person.email}`} value={person.role} onChange={role => void put({ shares: current().shares.map(entry => entry.email === person.email ? { ...entry, role } : entry) })} /><button type="button" aria-label={`Remove ${person.email}`} onClick={() => void put({ shares: current().shares.filter(entry => entry.email !== person.email) })}>×</button></div></div>}</For>
              <form class="mt-1 flex gap-1" onSubmit={event => { event.preventDefault(); const address = email().trim(); if (address) { void put({ shares: [...current().shares, { email: address, role: 'viewer' }] }); setEmail(''); } }}><input aria-label="Invite email" type="email" value={email()} onInput={event => setEmail(event.currentTarget.value)} placeholder="email@example.com" class="min-w-0 flex-1 rounded border border-edge bg-bg px-2 py-1" /><button type="submit" aria-label="Add email" class="rounded border border-edge px-2 py-1">add</button></form>
            </section>
          </>}</Show>
        </div>
      </section>
    </div></Portal></Show>
  </>;
}
