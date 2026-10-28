/* @jsxImportSource solid-js */
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createEffect, createMemo, createSignal, For, lazy, onCleanup, onMount, Show, Suspense, type JSX } from 'solid-js';
import { ARTIFACT_ID_PATTERN, CARD_RENDER_GENERATION, type DatasetAccess, SHARE_ROLE_LABEL, SHARE_ROLES, type ShareEntry, type ShareRole, type SharingPatch, type Visibility } from '@artifactbin/contracts';
import type { DatasetCatalog } from '@/lib/datasets/types';
import { artifactEditPath } from '@/lib/http/urls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { SharingVerdict } from '@/lib/workspace/visibility-icons';
import { Tooltip } from '../ui/Tooltip';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { SectionHeading } from '../ui/PageHeader';
import { ToggleGroup } from '../ui/ToggleGroup';
import { Input } from '../ui/Field';
import { StatusMessage } from '../ui/StatusMessage';
import { sharingIconFor, VISIBILITY_ICON_NODES, type SharingIcon } from '@/lib/workspace/visibility-icons';
import Check from 'lucide-solid/icons/check';
import LinkIcon from 'lucide-solid/icons/link';
import PenLine from 'lucide-solid/icons/pen-line';
import X from 'lucide-solid/icons/x';
import { copyText } from '../lib/copy-text';
import { apiFetch } from '../lib/api';

/**
 * Lazy on purpose (a documented lazy-import exception): only the open sharing panel draws role selects, and
 * every reader's document page carries this module, so Select and its Popover load on first open instead
 * (the page-speed prose budget). Each use sits in its own <Suspense> so loading never suspends the page.
 */
const Select = lazy(() => import('../ui/Select').then((m) => ({ default: m.Select })));

const ROLE_OPTIONS = SHARE_ROLES.map((role) => ({ value: role, label: SHARE_ROLE_LABEL[role] }));
/** What the sharing surface is for: the Share dialog's description and the editor's Sharing tab say the same. */
const SHARING_DESCRIPTION = 'Manage access, invite people, or copy the link.';
const PUBLIC_DISABLED = 'Public documents are disabled on this server. Use unlisted to share with anyone who has the link, or private for invited people and group members.';
const VISIBILITY_TIPS = { public: 'anyone with the link · listed on your profile', unlisted: 'anyone with the link · not listed anywhere', private: 'only you and invited emails' } as const;

/** The sharing verdict's icon, from the same nodes the served rail draws (lib/visibility-icons). */
function VisibilityIcon(props: { icon: SharingIcon; size: number; class?: string }): JSX.Element {
  return <svg xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class={props.class}
    innerHTML={VISIBILITY_ICON_NODES[props.icon].map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).filter(([name]) => name !== 'key').map(([name, value]) => `${name}="${String(value)}"`).join(' ')}/>`).join('')} />;
}

interface SharingState {
  visibility: Visibility; linkRole: ShareRole; shares: ShareEntry[]; canPrivate?: boolean; canPublic?: boolean;
  /** A dataset's writes: who may change it through a document. */
  access?: DatasetAccess; datasetKind?: DatasetCatalog['kind']; policyVersion?: number;
  writtenBy?: Array<{ id: string; title: string | null; mutations: string[] }>;
}
// Module-level, so the groups' option objects keep their identity across the refetches a change causes (ToggleGroup keys by it, and a rebuilt row would drop focus).
const VISIBILITY_OPTIONS = (['public', 'unlisted', 'private'] as const).map(value => ({
  value, label: value as string, ariaLabel: `Make ${value}`, tooltip: VISIBILITY_TIPS[value], icon: () => <VisibilityIcon icon={value} size={11} class="shrink-0" />,
}));
const WRITE_OPTIONS = [
  { value: 'read', label: 'read-only', ariaLabel: 'Make read-only', tooltip: 'documents may only read this data' },
  { value: 'readwrite', label: 'read & write', ariaLabel: 'Make read & write', tooltip: 'you and dataset editors may add, change and remove rows' },
];

/** The document sharing door owns dialog state and sends one field per PATCH-shaped PUT. */
export function DocumentSharing(props: {
  id: string; title: string; owner: boolean; editable?: boolean; url?: string;
  variant?: 'chip' | 'menu' | 'dialog' | 'embedded'; onClose?: () => void;
  onSharingChange?: (verdict: SharingVerdict) => void;
  onSocialPreview?: () => void; version?: number;
  /** Embedded dataset editors can switch tabs without discarding their draft. */
  onDataActions?: () => void;
  /** The menu entry hands the dialog to its page (which closes the panel it sits in) instead of opening its own. */
  onOpen?: () => void;
  /** The artifact's format: a dataset's sharing also answers who may WRITE it (the writes row). */
  format?: string;
  datasetKind?: DatasetCatalog['kind'];
  /** Validated document dependencies; access remains independent of document sharing. */
  refs?: ReadonlyArray<{ id: string; kind: string }>;
}): JSX.Element {
  const canManage = () => props.owner || Boolean(props.editable);
  const [open, setOpen] = createSignal(props.variant === 'dialog');
  const [state, setState] = createSignal<SharingState | null>(null);
  const canPrivate = createMemo(() => state()?.canPrivate !== false);
  const canPublic = createMemo(() => state()?.canPublic !== false);
  const visibilityOptions = createMemo(() => VISIBILITY_OPTIONS.filter(option => option.value !== 'private' || canPrivate()).map(option => option.value === 'public' && !canPublic() ? { ...option, disabled: true, tooltip: PUBLIC_DISABLED } : option));
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
    void copyText(target.origin + target.pathname);
    setCopied(true);
  };
  const put = async (patch: SharingPatch): Promise<boolean> => {
    setError('');
    try {
      const response = await apiFetch(endpoint, 'PUT', patch);
      if (!response.ok) {
        const refusal = await response.json().catch(() => null) as { hint?: unknown; message?: unknown; details?: unknown; error?: unknown } | null;
        const message = [refusal?.hint, refusal?.message, ...(Array.isArray(refusal?.details) ? refusal.details : []), refusal?.error]
          .find((value): value is string => typeof value === 'string' && !!value.trim());
        setError(message ?? 'could not update sharing');
        return false;
      }
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
    void retryingFetch(endpoint, { signal: controller.signal }).then(async response => {
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
  /** The card's address, built only from an id of the artifact id's own allowlisted shape. */
  const previewSrc = () => ARTIFACT_ID_PATTERN.test(props.id) ? `/a/${props.id}/export?format=jpg&mode=card&v=${Number(props.version ?? 0)}&r=${CARD_RENDER_GENERATION}` : undefined;
  const datasetRefs = () => (props.refs ?? []).filter(ref => ref.kind === 'dataset');
  const body = () => <>
    <Button variant="secondary" size="sm" aria-label="Copy link" onClick={copy} class="mb-4 w-full">
      <Show when={copied()} fallback={<LinkIcon size={11} />}><Check size={11} /></Show> {copied() ? 'copied' : 'copy link'}
    </Button>
    <Show when={canManage() && state() && state()!.visibility !== 'private' && datasetRefs().length > 0}>
      <aside aria-label="Dataset access when sharing" class="mb-4 rounded-md border border-edge bg-raised p-3 leading-relaxed text-muted">
        <p>This link shares the document, not access to its datasets. If a dataset is private, invite the reader there too, or make it unlisted if everyone with this link should be able to read it.</p>
        <ul class="mt-2 space-y-1"><For each={datasetRefs()}>{ref => <li>
          <a href={`/a/${encodeURIComponent(ref.id)}`} aria-label={`Review dataset ${ref.id} sharing`} class="text-accent underline underline-offset-2">Review dataset {ref.id}</a>
        </li>}</For></ul>
      </aside>
    </Show>
    <Show when={props.onSocialPreview}><figure class="mx-auto mb-5 w-full max-w-xs"><figcaption class="mb-2 text-center text-2xs text-muted">Social preview</figcaption>
      <div class="relative aspect-[40/21] w-full overflow-hidden rounded-md border border-edge bg-raised">
        <Show when={previewStatus() !== 'ready'}><div role="status" class="absolute inset-0 flex items-center justify-center text-2xs text-muted">{previewStatus() === 'loading' ? 'Loading preview…' : 'Preview unavailable'}</div></Show>
        <Show when={previewStatus() !== 'error'}><img alt="Current social preview" src={previewSrc()}
          onLoad={() => setPreviewStatus('ready')} onError={() => setPreviewStatus('error')} class={`h-full w-full object-contain transition-opacity duration-200 motion-reduce:transition-none ${previewStatus() === 'ready' ? 'opacity-100' : 'opacity-0'}`} /></Show>
        <Tooltip content="Edit thumbnail"><Button variant="secondary" size="sm" icon aria-label="Edit social preview" onClick={() => { close(); props.onSocialPreview?.(); }}
          class="absolute right-2 top-2"><PenLine size={15} /></Button></Tooltip>
      </div>
    </figure></Show>
    <Show when={canManage() && !state() && !error()}><StatusMessage kind="loading">loading…</StatusMessage></Show>
    <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
    <Show when={canManage() && state()}>{current => <>
      <ToggleGroup label="Link visibility" fill value={current().visibility} options={visibilityOptions()} onChange={value => void put({ visibility: value as Visibility })} />
      <Show when={!canPublic()}><p aria-label="Public visibility policy" class="mt-2 leading-relaxed text-muted">{PUBLIC_DISABLED}</p></Show>
      <Show when={current().visibility !== 'private'}>
        <label class="mt-2 flex items-center justify-between gap-2 text-muted"><span>anyone with the link</span>
          <span class="w-32 shrink-0"><Suspense fallback={<span class="block h-control-sm" />}><Select size="sm" ariaLabel="Link role" value={current().linkRole ?? 'viewer'} options={ROLE_OPTIONS} onChange={role => void put({ linkRole: role as ShareRole })} /></Suspense></span>
        </label>
      </Show>
      <Show when={postgres()}><p aria-label="PostgreSQL read-only access" class="mt-5 border-t border-edge pt-4 leading-relaxed text-muted">Editors can manage the connection, notebook and whitelist. Viewers can query exposed data. Database rows cannot be changed here.</p></Show>
      <Show when={showWrites()}>
        <div class="mt-5 border-t border-edge pt-4">
          <p class="mb-1 flex items-center justify-between text-faint"><span class="uppercase tracking-wider">writes</span><PenLine size={11} /></p>
          <ToggleGroup label="Dataset writes" fill value={current().access ?? 'read'} options={WRITE_OPTIONS} onChange={value => setAccess(value as DatasetAccess)} />
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
              <span class="w-32 shrink-0" data-slot={current().visibility !== 'private' && person.role !== 'editor' ? 'tooltip-trigger' : undefined}><Suspense fallback={<span class="block h-control-sm" />}><Select size="sm" ariaLabel={`Role for ${person.email}`} value={person.role} options={ROLE_OPTIONS}
                onChange={role => void put({ shares: current().shares.map(entry => entry.email === person.email ? { ...entry, role: role as ShareRole } : entry) })} /></Suspense></span>
            </Tooltip>
            <Button variant="ghost" size="sm" icon aria-label={`Remove ${person.email}`} onClick={() => void put({ shares: current().shares.filter(entry => entry.email !== person.email) })}><X size={11} /></Button>
          </span>
        </div>}</For>
        <form class="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); const address = email().trim(); if (!address) return; void put({ shares: [...current().shares, { email: address, role: 'viewer' }] }); setEmail(''); }}>
          <Input size="sm" aria-label="Invite email" placeholder="email@example.com" value={email()} onInput={event => setEmail(event.currentTarget.value)} class="flex-1" />
          <Button type="submit" variant="secondary" size="sm" aria-label="Add email">Add</Button>
        </form>
      </div>
      <Show when={props.format === 'dataset' && !postgres()}><Button variant="secondary" size="sm" aria-label="Manage access policies" onClick={(event: MouseEvent) => { close(); if (props.onDataActions) { event.preventDefault(); props.onDataActions(); } }} href={artifactEditPath(props.id)} class="mt-4 w-full justify-start">manage data actions ↗</Button></Show>
    </>}</Show>
  </>;
  const heading = () => `Share “${props.title || (props.format === 'folder' ? 'Untitled folder' : 'Untitled')}”`;
  const verdict = () => sharingIconFor({ visibility: state()?.visibility ?? 'private', hasInvitedUsers: (state()?.shares.length ?? 0) > 0 });
  // The embedded surface (the editor's Sharing tab, a dataset's) heads its controls the way the Share dialog does:
  // a sans heading and description over the same chrome-density body.
  if (props.variant === 'embedded') return <section aria-label="Sharing">
    <header class="mb-4"><SectionHeading>{heading()}</SectionHeading><p class="mt-2 font-sans text-sm leading-relaxed text-muted">{SHARING_DESCRIPTION}</p></header>
    <div class="font-mono text-xs">{body()}</div>
  </section>;
  return <>
    <Show when={props.variant !== 'dialog'}>
      <Show when={canManage() || props.onSocialPreview} fallback={
        <Button variant="ghost" size="sm" aria-label="Share" onClick={copy} class="w-full justify-start">
          <Show when={copied()} fallback={<LinkIcon size={14} />}><Check size={14} /></Show>{copied() ? 'copied link' : 'share'}
        </Button>}>
        <Button variant={props.variant === 'menu' ? 'ghost' : 'secondary'} size="sm" aria-label="Share" onClick={() => props.onOpen ? props.onOpen() : setOpen(value => !value)} class={props.variant === 'menu' ? 'w-full justify-start' : ''}>
          <VisibilityIcon icon={verdict()} size={props.variant === 'menu' ? 14 : 12} />
          <span>{state() ? `sharing · ${state()!.visibility}` : 'sharing'}</span>
        </Button>
      </Show>
    </Show>
    <Show when={open()}>
      <Dialog title={heading()} label="Sharing" size="lg" lockScroll initialFocus="[data-close-sharing]" onClose={close}
        description={SHARING_DESCRIPTION}
        footer={<Button variant="secondary" aria-label="Close sharing" data-close-sharing onClick={close}>Close</Button>}>
        <div class="font-mono text-xs">{body()}</div>
      </Dialog>
    </Show>
  </>;
}
