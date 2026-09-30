/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { SHARE_ROLES, SHARE_ROLE_LABEL, type ShareEntry, type ShareRole } from '@/lib/share-roles';
import type { SharingPatch, Visibility } from '@/lib/artifacts';
import type { SharingVerdict } from '@/lib/visibility-icons';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';
import { Tooltip } from '../components/Tooltip';
import { SelectMenu } from '../components/SelectMenu';
import { sharingIconFor, VISIBILITY_ICON_NODES, type SharingIcon } from '@/lib/visibility-icons';
import Check from 'lucide-solid/icons/check';
import LinkIcon from 'lucide-solid/icons/link';
import PenLine from 'lucide-solid/icons/pen-line';
import X from 'lucide-solid/icons/x';

const ROLE_OPTIONS = SHARE_ROLES.map((role) => ({ value: role, label: SHARE_ROLE_LABEL[role] }));
const VISIBILITY_TIPS = { public: 'anyone with the link · listed on your profile', unlisted: 'anyone with the link · not listed anywhere', private: 'only you and invited emails' } as const;

/** The sharing verdict's icon, from the same nodes the served rail draws (lib/visibility-icons). */
export function VisibilityIcon(props: { icon: SharingIcon; size: number; class?: string }): JSX.Element {
  return <svg xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class={props.class}
    innerHTML={VISIBILITY_ICON_NODES[props.icon].map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).filter(([name]) => name !== 'key').map(([name, value]) => `${name}="${String(value)}"`).join(' ')}/>`).join('')} />;
}

interface SharingState {
  visibility: Visibility; linkRole: ShareRole; shares: ShareEntry[]; canPrivate?: boolean;
}

/** The document sharing door owns dialog state and sends one field per PATCH-shaped PUT. */
export function DocumentSharing(props: {
  id: string; title: string; owner: boolean; editable?: boolean; url?: string;
  variant?: 'chip' | 'menu' | 'dialog' | 'embedded'; onClose?: () => void;
  onSharingChange?: (verdict: SharingVerdict) => void;
  onSocialPreview?: () => void; version?: number;
  /** The menu entry hands the dialog to its page (which closes the panel it sits in) instead of opening its own. */
  onOpen?: () => void;
}): JSX.Element {
  const canManage = () => props.owner || Boolean(props.editable);
  const [open, setOpen] = createSignal(props.variant === 'dialog');
  const [state, setState] = createSignal<SharingState | null>(null);
  const [email, setEmail] = createSignal('');
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [previewStatus, setPreviewStatus] = createSignal<'loading' | 'ready' | 'error'>('loading');
  createEffect(() => {
    if (!copied()) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    onCleanup(() => clearTimeout(timer));
  });
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
  createEffect(() => { void props.version; setPreviewStatus('loading'); });
  createEffect(() => {
    if (!open()) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    window.addEventListener('keydown', escape);
    onCleanup(() => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); });
  });
  const body = () => <>
    <button type="button" aria-label="Copy link" onClick={copy} class="mb-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[5px] border border-edge bg-raised px-3 py-2.5 text-muted hover:border-edge-bright hover:text-fg">
      <Show when={copied()} fallback={<LinkIcon size={11} />}><Check size={11} /></Show> {copied() ? 'copied' : 'copy link'}
    </button>
    <Show when={props.onSocialPreview}><figure class="mx-auto mb-5 w-full max-w-xs"><figcaption class="mb-2 text-center text-[11px] text-muted">Social preview</figcaption>
      <div class="relative aspect-[40/21] w-full overflow-hidden rounded-md border border-edge bg-raised">
        <Show when={previewStatus() !== 'ready'}><div role="status" class="absolute inset-0 flex items-center justify-center text-[11px] text-muted">{previewStatus() === 'loading' ? 'Loading preview…' : 'Preview unavailable'}</div></Show>
        <Show when={previewStatus() !== 'error'}><img alt="Current social preview" src={`/a/${encodeURIComponent(props.id)}/export?format=jpg&mode=card&v=${props.version ?? 0}&r=${CARD_RENDER_GENERATION}`}
          onLoad={() => setPreviewStatus('ready')} onError={() => setPreviewStatus('error')} class={`h-full w-full object-contain transition-opacity duration-200 motion-reduce:transition-none ${previewStatus() === 'ready' ? 'opacity-100' : 'opacity-0'}`} /></Show>
        <Tooltip content="Edit thumbnail"><button type="button" aria-label="Edit social preview" onClick={() => { close(); props.onSocialPreview?.(); }}
          class="absolute right-2 top-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-edge-bright bg-surface text-fg shadow-sm transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><PenLine size={15} /></button></Tooltip>
      </div>
    </figure></Show>
    <Show when={canManage() && !state() && !error()}><p class="text-muted">loading…</p></Show>
    <Show when={error()}><p role="alert" class="text-red-400">{error()}</p></Show>
    <Show when={canManage() && state()}>{current => <>
      <div class="flex gap-1"><For each={(['public', 'unlisted', 'private'] as const).filter(value => value !== 'private' || current().canPrivate !== false)}>{visibility =>
        <Tooltip content={VISIBILITY_TIPS[visibility]}>
          <button type="button" aria-label={`Make ${visibility}`} aria-pressed={current().visibility === visibility} onClick={() => void put({ visibility })}
            class={`flex-1 cursor-pointer whitespace-nowrap rounded-[4px] border px-2 py-2.5 ${current().visibility === visibility ? 'border-accent/40 bg-accent-soft text-accent' : 'border-edge text-muted hover:border-edge-bright hover:text-fg'}`}>
            <VisibilityIcon icon={visibility} size={11} class="mr-1 inline" /> {visibility}
          </button>
        </Tooltip>
      }</For></div>
      <Show when={current().visibility !== 'private'}>
        <label class="mt-2 flex items-center justify-between gap-2 text-muted"><span>anyone with the link</span>
          <span class="w-32 shrink-0"><SelectMenu ariaLabel="Link role" value={current().linkRole ?? 'viewer'} options={ROLE_OPTIONS} onChange={role => void put({ linkRole: role as ShareRole })} /></span>
        </label>
      </Show>
      <div class="mt-5 border-t border-edge pt-4">
        <p class="mb-1 uppercase tracking-wider text-faint">people</p>
        <For each={current().shares}>{person => <div class="flex items-center justify-between gap-2 py-0.5">
          <span class="min-w-0 truncate">{person.email}</span>
          <span class="flex shrink-0 items-center gap-1">
            <Tooltip content="already viewable by link" disabled={current().visibility === 'private' || person.role === 'editor'}>
              <span class="w-32 shrink-0" data-slot={current().visibility !== 'private' && person.role !== 'editor' ? 'tooltip-trigger' : undefined}><SelectMenu ariaLabel={`Role for ${person.email}`} value={person.role} options={ROLE_OPTIONS}
                onChange={role => void put({ shares: current().shares.map(entry => entry.email === person.email ? { ...entry, role: role as ShareRole } : entry) })} /></span>
            </Tooltip>
            <button type="button" aria-label={`Remove ${person.email}`} onClick={() => void put({ shares: current().shares.filter(entry => entry.email !== person.email) })} class="cursor-pointer text-muted hover:text-fg"><X size={11} /></button>
          </span>
        </div>}</For>
        <form class="mt-1 flex gap-1" onSubmit={event => { event.preventDefault(); const address = email().trim(); if (!address) return; void put({ shares: [...current().shares, { email: address, role: 'viewer' }] }); setEmail(''); }}>
          <input aria-label="Invite email" placeholder="email@example.com" value={email()} onInput={event => setEmail(event.currentTarget.value)}
            class="min-w-0 flex-1 rounded-[4px] border border-edge bg-transparent px-2 py-1 text-fg outline-none focus:border-edge-bright" />
          <button type="submit" aria-label="Add email" class="cursor-pointer rounded-[4px] border border-edge px-2 py-1 text-muted hover:border-edge-bright hover:text-fg">add</button>
        </form>
      </div>
    </>}</Show>
  </>;
  const heading = () => `Share “${props.title || 'Untitled'}”`;
  const verdict = () => sharingIconFor({ visibility: state()?.visibility ?? 'private', hasInvitedUsers: (state()?.shares.length ?? 0) > 0 });
  if (props.variant === 'embedded') return <section aria-label="Sharing" class="font-mono text-xs"><h2 class="mb-4 text-base font-semibold text-fg">{heading()}</h2>{body()}</section>;
  return <>
    <Show when={props.variant !== 'dialog'}>
      <Show when={canManage() || props.onSocialPreview} fallback={
        <button type="button" aria-label="Share" onClick={copy} class="flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-fg">
          <Show when={copied()} fallback={<LinkIcon size={14} />}><Check size={14} /></Show>{copied() ? 'copied link' : 'share'}
        </button>}>
        <button type="button" aria-label="Share" onClick={() => props.onOpen ? props.onOpen() : setOpen(value => !value)} class={props.variant === 'menu'
          ? `flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs transition-colors hover:bg-raised hover:text-fg ${open() ? 'text-accent' : 'text-muted'}`
          : 'inline-flex items-center gap-1 rounded border border-edge px-2 py-1 text-xs'}>
          <VisibilityIcon icon={verdict()} size={props.variant === 'menu' ? 14 : 12} />
          <span>{state() ? `sharing · ${state()!.visibility}` : 'sharing'}</span>
        </button>
      </Show>
    </Show>
    <Show when={open()}><Portal mount={trustedPortalOf(document) ?? document.body}><div class="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-8">
      <button type="button" aria-label="Close sharing by clicking outside" onClick={close} class="absolute inset-0 cursor-default border-0 bg-black/45 p-0 backdrop-blur-[2px]" />
      <section role="dialog" aria-modal="true" aria-label="Sharing" class="relative z-10 flex w-full max-w-2xl animate-[rise_.16s_ease-out] flex-col overflow-hidden rounded-[9px] border border-edge-bright bg-surface font-mono text-xs shadow-2xl" style={{ 'max-height': 'calc(100svh - 24px)' }}>
        <header class="flex items-start gap-4 border-b border-edge px-4 py-4 sm:px-6"><div class="min-w-0 flex-1"><h2 class="break-words text-base font-semibold text-fg">{heading()}</h2><p class="mt-1 text-[11px] text-faint">Manage access, invite people, or copy the link.</p></div>
          <button type="button" aria-label="Close sharing" autofocus onClick={close} class="ml-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted hover:bg-raised hover:text-fg"><X size={16} /></button></header>
        <div class="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{body()}</div>
      </section>
    </div></Portal></Show>
  </>;
}
