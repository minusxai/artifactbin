/* @jsxImportSource solid-js */
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js';
import type { DatasetCatalog } from '@/lib/datasets';
import type { DatasetAccess, ShareEntry, ShareRole, SharingPatch, Visibility } from '@artifactbin/contracts';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Field';
import { Select } from '../ui/Select';
import { StatusMessage } from '../ui/StatusMessage';
import { ToggleGroup } from '../ui/ToggleGroup';
import { copyText } from '../lib/copy-text';
import { apiFetch } from '../lib/api';
interface SharingState {
  visibility: Visibility; linkRole: ShareRole; shares: ShareEntry[]; access?: DatasetAccess;
  datasetKind?: DatasetCatalog['kind']; policyVersion?: number; canPrivate?: boolean;
  writtenBy?: Array<{ id: string; title: string | null; mutations: string[] }>;
}

const ROLE_OPTIONS = [{ value: 'viewer', label: 'can view' }, { value: 'editor', label: 'can edit' }];
function RolePicker(props: { label: string; value: ShareRole; onChange: (role: ShareRole) => void }): JSX.Element {
  return <Select size="sm" class="w-32" ariaLabel={props.label} value={props.value} options={ROLE_OPTIONS} onChange={role => props.onChange(role as ShareRole)} />;
}
/** Sharing edits stay on the scoped artifact endpoint; copied links contain no secret or query. */
export default function ShareLink(props: { artifactId?: string; title?: string; format?: string; datasetKind?: DatasetCatalog['kind']; editable?: boolean; class?: string; url?: string; startOpen?: boolean; onClose?: () => void }): JSX.Element {
  const [open, setOpen] = createSignal(Boolean(props.startOpen));
  const [state, setState] = createSignal<SharingState | null>(null);
  const [email, setEmail] = createSignal('');
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [confirmReadOnly, setConfirmReadOnly] = createSignal(false);
  const canManage = () => Boolean(props.artifactId && props.editable);
  const endpoint = () => `/api/my/artifacts/${encodeURIComponent(props.artifactId!)}/sharing`;
  onMount(() => { if (canManage()) void retryingFetch(endpoint()).then(async response => { if (!response.ok) throw new Error('Could not load sharing.'); return response.json() as Promise<SharingState>; }).then(setState).catch(cause => setError(cause.message)); });
  const update = async (patch: SharingPatch) => {
    if (!canManage()) return false;
    setError('');
    try {
      const response = await apiFetch(endpoint(), 'PUT', patch);
      if (!response.ok) throw new Error('Could not update sharing.');
      setState(await response.json() as SharingState); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update sharing.'); return false; }
  };
  const copyLink = () => { void copyText(new URL(props.url ?? location.pathname, location.origin).href); setCopied(true); };
  const postgres = () => props.format === 'dataset' && (props.datasetKind === 'postgres' || state()?.datasetKind === 'postgres');
  const showWrites = () => props.format === 'dataset' && state() && !postgres() && state()?.policyVersion !== 2;
  const close = () => { setOpen(false); props.onClose?.(); };
  // One option object per visibility, built once per `canPrivate` answer: ToggleGroup keys its buttons by option identity, so rebuilding them on every sharing update would replace the button the person just pressed.
  const allowPrivate = createMemo(() => state()?.canPrivate !== false);
  const visibilityOptions = createMemo(() => (['public', 'unlisted', 'private'] as const).filter(value => value !== 'private' || allowPrivate()).map(value => ({ value, label: value, ariaLabel: `Make ${value}`, get disabled() { return !state(); } })));
  return <>
    <Show when={!props.startOpen}><Button variant="secondary" size="sm" aria-label="Share" class={props.class} onClick={() => canManage() ? setOpen(true) : copyLink()}>{copied() ? 'copied' : state() ? `share: ${state()!.visibility}` : 'Share'}</Button></Show>
    <Show when={open()}><Dialog title="Sharing" description={props.title} size="md" onClose={close}
      footer={<Button variant="secondary" aria-label="Close sharing" onClick={close}>Close</Button>}>
      <div class="space-y-4 text-sm">
        <Button variant="secondary" class="w-full" aria-label="Copy link" onClick={copyLink}>{copied() ? 'copied' : 'copy link'}</Button>
        <ToggleGroup label="Visibility" size="md" fill value={state()?.visibility ?? ''} onChange={visibility => void update({ visibility: visibility as Visibility })} options={visibilityOptions()} />
        <Input aria-label="Invite email" type="email" value={email()} onInput={event => setEmail(event.currentTarget.value)} placeholder="email@example.com" />
        <Show when={state()} fallback={<StatusMessage kind="loading">Loading sharing…</StatusMessage>}>{current => <>
          <Show when={current().visibility !== 'private'}><div class="flex items-center justify-between">Anyone with the link<RolePicker label="Link role" value={current().linkRole ?? 'viewer'} onChange={role => void update({ linkRole: role })} /></div></Show>
          <Show when={postgres()}><p aria-label="PostgreSQL read-only access">Editors can manage the connection, notebook and whitelist. Viewers can query exposed data. Database rows cannot be changed here.</p></Show>
          <Show when={showWrites()}><section aria-label="Dataset writes" class="space-y-2 border-t border-edge pt-4"><h3 class="font-semibold">Writes</h3><ToggleGroup label="Write access" value={current().access === 'readwrite' ? 'readwrite' : 'read'} onChange={next => next === 'read' ? (current().writtenBy?.length ? setConfirmReadOnly(true) : void update({ access: 'read' })) : void update({ access: 'readwrite' })}
            options={[{ value: 'read', label: 'read-only', ariaLabel: 'Make read-only' }, { value: 'readwrite', label: 'read & write', ariaLabel: 'Make read & write' }]} />
            <For each={current().writtenBy ?? []}>{writer => <p>{writer.title ?? writer.id} · {writer.mutations.join(', ')}</p>}</For>
          </section></Show>
          <section class="space-y-2 border-t border-edge pt-4"><h3 class="font-semibold">People</h3><For each={current().shares}>{entry => <div class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate">{entry.email}</span><RolePicker label={`Role for ${entry.email}`} value={entry.role} onChange={role => void update({ shares: current().shares.map(person => person.email === entry.email ? { ...person, role } : person) })} /><Button size="sm" variant="ghost" aria-label={`Remove ${entry.email}`} onClick={() => void update({ shares: current().shares.filter(person => person.email !== entry.email) })}>Remove</Button></div>}</For>
            <form class="flex gap-2" onSubmit={event => { event.preventDefault(); const address = email().trim(); if (!address) return; void update({ shares: [...current().shares, { email: address, role: 'viewer' }] }); setEmail(''); }}><Button type="submit" size="sm" variant="secondary" aria-label="Add email">add</Button></form>
          </section>
          <Show when={props.format === 'dataset' && !postgres()}><a aria-label="Manage access policies" href={`/a/${props.artifactId}/edit`} onClick={() => setOpen(false)}>Manage data actions ↗</a></Show>
        </>}</Show>
        <Show when={error()}><StatusMessage kind="error">{error()}</StatusMessage></Show>
      </div>
    </Dialog></Show>
    <Show when={confirmReadOnly()}><ConfirmDialog title="Make this dataset read-only?" description="Documents that write here will stop working until writes are enabled again. The rows stay." action="Make read-only" confirmLabel="Confirm read-only" cancelLabel="Keep writable" onCancel={() => setConfirmReadOnly(false)} onConfirm={() => { void update({ access: 'read' }); setConfirmReadOnly(false); }} /></Show>
  </>;
}
