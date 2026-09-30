/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { SHARE_ROLES, SHARE_ROLE_LABEL, type ShareEntry, type ShareRole } from '@/lib/share-roles';
import type { DatasetAccess, SharingPatch, Visibility } from '@/lib/artifacts';
import type { DatasetCatalog } from '@/lib/datasets/types';
import { artifactEditPath } from '@/lib/urls';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { SharingVerdict } from '@/lib/visibility-icons';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';
import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts';
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
  /** A dataset's writes (components/ShareLink's WRITES row): who may change it through a document. */
  access?: DatasetAccess; datasetKind?: DatasetCatalog['kind']; policyVersion?: number;
  writtenBy?: Array<{ id: string; title: string | null; mutations: string[] }>;
}
const WRITE_CHOICES = [
  ['read', 'read-only', 'documents may only read this data'],
  ['readwrite', 'read & write', 'you and dataset editors may add, change and remove rows'],
] as const;

/** The document sharing door owns dialog state and sends one field per PATCH-shaped PUT. */
export function DocumentSharing(props: {
  id: string; title: string; owner: boolean; editable?: boolean; url?: string;
  variant?: 'chip' | 'menu' | 'dialog' | 'embedded'; onClose?: () => void;
  onSharingChange?: (verdict: SharingVerdict) => void;
  onSocialPreview?: () => void; version?: number;
  /** The menu entry hands the dialog to its page (which closes the panel it sits in) instead of opening its own. */
  onOpen?: () => void;
  /** The artifact's format: a dataset's sharing also answers who may WRITE it (the writes row). */
  format?: string;
  datasetKind?: DatasetCatalog['kind'];
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
  const put = async (patch: SharingPatch): Promise<boolean> => {
    setError('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error('could not update sharing');
      setState(await response.json() as SharingState);
      return true;
    } catch { setError('could not update sharing'); return false; }
  };
  // A dataset: a PostgreSQL one is read-only by construction; a stored one says who may write it.
  const postgres = () => props.format === 'dataset' && (props.datasetKind === 'postgres' || state()?.datasetKind === 'postgres');
  const showWrites = () => props.format === 'dataset' && !!state() && !postgres() && state()!.policyVersion !== 2;
  const writable = () => !postgres() && state()?.access === 'readwrite';
  const [confirmReadOnly, setConfirmReadOnly] = createSignal(false);
  const [readOnlyBusy, setReadOnlyBusy] = createSignal(false);
  const [readOnlyError, setReadOnlyError] = createSignal<string | null>(null);
  // Closing writes never touches the rows, but it stops the documents that write here: say which first.
  const setAccess = (next: DatasetAccess) => {
    if (next === 'read' && (state()?.writtenBy?.length ?? 0) > 0) { setReadOnlyError(null); setConfirmReadOnly(true); return; }
    void put({ access: next });
  };
  const confirmMakeReadOnly = async () => {
    setReadOnlyBusy(true);
    const done = await put({ access: 'read' });
    setReadOnlyBusy(false);
    if (done) setConfirmReadOnly(false);
    else setReadOnlyError('Could not update sharing. Try again.');
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
  /** The card's address, built only from an id of the artifact id's own allowlisted shape. */
  const previewSrc = () => ARTIFACT_ID_PATTERN.test(props.id) ? `/a/${props.id}/export?format=jpg&mode=card&v=${Number(props.version ?? 0)}&r=${CARD_RENDER_GENERATION}` : undefined;
  const body = () => <>
    <button type="button" aria-label="Copy link" onClick={copy} class="mb-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[5px] border border-edge bg-raised px-3 py-2.5 text-muted hover:border-edge-bright hover:text-fg">
      <Show when={copied()} fallback={<LinkIcon size={11} />}><Check size={11} /></Show> {copied() ? 'copied' : 'copy link'}
    </button>
    <Show when={props.onSocialPreview}><figure class="mx-auto mb-5 w-full max-w-xs"><figcaption class="mb-2 text-center text-[11px] text-muted">Social preview</figcaption>
      <div class="relative aspect-[40/21] w-full overflow-hidden rounded-md border border-edge bg-raised">
        <Show when={previewStatus() !== 'ready'}><div role="status" class="absolute inset-0 flex items-center justify-center text-[11px] text-muted">{previewStatus() === 'loading' ? 'Loading preview…' : 'Preview unavailable'}</div></Show>
        <Show when={previewStatus() !== 'error'}><img alt="Current social preview" src={previewSrc()}
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
      <Show when={postgres()}><p aria-label="PostgreSQL read-only access" class="mt-5 border-t border-edge pt-4 leading-relaxed text-muted">Editors can manage the connection, notebook and whitelist. Viewers can query exposed data. Database rows cannot be changed here.</p></Show>
      <Show when={showWrites()}>
        <div class="mt-5 border-t border-edge pt-4">
          <p class="mb-1 flex items-center justify-between text-faint"><span class="uppercase tracking-wider">writes</span><PenLine size={11} /></p>
          <div class="flex gap-1"><For each={WRITE_CHOICES}>{([value, name, tip]) =>
            <Tooltip content={tip}>
              <button type="button" aria-label={value === 'read' ? 'Make read-only' : 'Make read & write'} aria-pressed={(current().access ?? 'read') === value} onClick={() => setAccess(value)}
                class={`flex-1 cursor-pointer whitespace-nowrap rounded-[4px] border px-2 py-1.5 ${(current().access ?? 'read') === value ? value === 'readwrite' ? 'border-amber-500/40 bg-amber-500/10 text-amber-500' : 'border-accent/40 bg-accent-soft text-accent' : 'border-edge text-muted hover:border-edge-bright hover:text-fg'}`}>{name}</button>
            </Tooltip>
          }</For></div>
          <p class="mt-2 leading-relaxed text-muted">{writable()
            ? 'Sharing controls who can view and manage this dataset. Data rules below control which actions everyone with view access may run. Without a data policy, only dataset editors may write rows.'
            : 'Documents can only read this dataset. A <Mutation> naming it is refused when you publish.'}</p>
          <Show when={current().writtenBy?.length}><div class="mt-2"><p class="mb-1 uppercase tracking-wider text-faint">written by</p>
            <For each={current().writtenBy}>{writer => <div class="flex items-center justify-between py-0.5"><span class="truncate">{writer.title ?? writer.id}</span><span class="ml-2 shrink-0 text-faint">{writer.mutations.join(', ')}</span></div>}</For>
          </div></Show>
          <Show when={confirmReadOnly()}>
            <ConfirmDialog title="Make this dataset read-only?" action="Make read-only" confirmLabel="Confirm read-only" cancelLabel="Keep writable" danger busy={readOnlyBusy()} error={readOnlyError()}
              description={`${current().writtenBy?.length ?? 0} document${current().writtenBy?.length === 1 ? '' : 's'} write${current().writtenBy?.length === 1 ? 's' : ''} here. Their buttons will stop working until you turn writes back on. The rows stay.`}
              onConfirm={() => void confirmMakeReadOnly()} onCancel={() => setConfirmReadOnly(false)} />
          </Show>
        </div>
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
      <Show when={props.format === 'dataset' && !postgres()}><a aria-label="Manage access policies" onClick={close} href={artifactEditPath(props.id)} class="mt-4 block rounded-lg border border-edge px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg">Manage data actions ↗</a></Show>
    </>}</Show>
  </>;
  const heading = () => `Share “${props.title || (props.format === 'folder' ? 'Untitled folder' : 'Untitled')}”`;
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
