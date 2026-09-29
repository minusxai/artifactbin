/* @jsxImportSource solid-js */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import type { DatasetCatalog } from '@/lib/datasets/types';
import type { DatasetAccess, SharingPatch, Visibility } from '@/lib/artifacts';
import type { ShareEntry, ShareRole } from '@/lib/share-roles';
interface SharingState {
  visibility: Visibility; linkRole: ShareRole; shares: ShareEntry[]; access?: DatasetAccess;
  datasetKind?: DatasetCatalog['kind']; policyVersion?: number; canPrivate?: boolean;
  writtenBy?: Array<{ id: string; title: string | null; mutations: string[] }>;
}
/** Sharing edits stay on the scoped artifact endpoint; copied links contain no secret or query. */
export default function ShareLink(props: { artifactId?: string; title?: string; format?: string; datasetKind?: DatasetCatalog['kind']; editable?: boolean; class?: string; url?: string }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createSignal<SharingState | null>(null);
  const [email, setEmail] = createSignal('');
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [confirmReadOnly, setConfirmReadOnly] = createSignal(false);
  const canManage = () => Boolean(props.artifactId && props.editable);
  const endpoint = () => `/api/my/artifacts/${encodeURIComponent(props.artifactId!)}/sharing`;
  onMount(() => { if (canManage()) void fetch(endpoint()).then(async response => { if (!response.ok) throw new Error('Could not load sharing.'); return response.json() as Promise<SharingState>; }).then(setState).catch(cause => setError(cause.message)); });
  const update = async (patch: SharingPatch) => {
    if (!canManage()) return false;
    setError('');
    try {
      const response = await fetch(endpoint(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error('Could not update sharing.');
      setState(await response.json() as SharingState); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update sharing.'); return false; }
  };
  const copyLink = () => { void navigator.clipboard?.writeText(new URL(props.url ?? location.pathname, location.origin).href); setCopied(true); };
  const postgres = () => props.format === 'dataset' && (props.datasetKind === 'postgres' || state()?.datasetKind === 'postgres');
  const showWrites = () => props.format === 'dataset' && state() && !postgres() && state()?.policyVersion !== 2;
  return <>
    <button type="button" aria-label="Share" class={props.class} onClick={() => canManage() ? setOpen(true) : copyLink()}>{copied() ? 'copied' : state() ? `share: ${state()!.visibility}` : 'Share'}</button>
    <Show when={open()}><div role="dialog" aria-modal="true" aria-label="Sharing" class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div class="max-h-[90vh] w-full max-w-lg space-y-4 overflow-auto rounded-xl border border-edge bg-surface p-6 text-sm text-fg">
        <div class="flex justify-between"><h2 class="text-lg font-semibold">Sharing {props.title}</h2><button type="button" aria-label="Close sharing" onClick={() => setOpen(false)}>Close</button></div>
        <button type="button" aria-label="Copy link" onClick={copyLink} class="w-full rounded border border-edge p-2">{copied() ? 'copied' : 'copy link'}</button>
        <div class="flex gap-1"><For each={(['public', 'unlisted', 'private'] as const).filter(value => value !== 'private' || state()?.canPrivate !== false)}>{visibility =>
          <button type="button" aria-label={`Make ${visibility}`} aria-pressed={state()?.visibility === visibility} disabled={!state()} onClick={() => void update({ visibility })} class="flex-1 rounded border border-edge p-2 aria-pressed:border-accent">{visibility}</button>
        }</For></div>
        <input aria-label="Invite email" type="email" value={email()} onInput={event => setEmail(event.currentTarget.value)} placeholder="email@example.com" class="w-full rounded border border-edge bg-surface p-2" />
        <Show when={state()} fallback={<p role="status">Loading sharing…</p>}>{current => <>
          <Show when={current().visibility !== 'private'}><label class="flex items-center justify-between">Anyone with the link<select aria-label="Link role" value={current().linkRole ?? 'viewer'} onChange={event => void update({ linkRole: event.currentTarget.value as ShareRole })} class="rounded border border-edge bg-surface p-2"><option value="viewer">can view</option><option value="editor">can edit</option></select></label></Show>
          <Show when={postgres()}><p aria-label="PostgreSQL read-only access">Editors can manage the connection, notebook and whitelist. Viewers can query exposed data. Database rows cannot be changed here.</p></Show>
          <Show when={showWrites()}><section aria-label="Dataset writes" class="space-y-2 border-t border-edge pt-4"><h3 class="font-semibold">Writes</h3><div class="flex gap-2"><button type="button" aria-label="Make read-only" aria-pressed={current().access !== 'readwrite'} onClick={() => current().writtenBy?.length ? setConfirmReadOnly(true) : void update({ access: 'read' })}>read-only</button><button type="button" aria-label="Make read & write" aria-pressed={current().access === 'readwrite'} onClick={() => void update({ access: 'readwrite' })}>read &amp; write</button></div>
            <For each={current().writtenBy ?? []}>{writer => <p>{writer.title ?? writer.id} · {writer.mutations.join(', ')}</p>}</For>
            <Show when={confirmReadOnly()}><div role="alertdialog" aria-label="Make this dataset read-only?"><p>Documents that write here will stop working until writes are enabled again. The rows stay.</p><button type="button" aria-label="Confirm read-only" onClick={() => { void update({ access: 'read' }); setConfirmReadOnly(false); }}>Make read-only</button><button type="button" onClick={() => setConfirmReadOnly(false)}>Keep writable</button></div></Show>
          </section></Show>
          <section class="space-y-2 border-t border-edge pt-4"><h3 class="font-semibold">People</h3><For each={current().shares}>{entry => <div class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate">{entry.email}</span><select aria-label={`Role for ${entry.email}`} value={entry.role} onChange={event => void update({ shares: current().shares.map(person => person.email === entry.email ? { ...person, role: event.currentTarget.value as ShareRole } : person) })} class="rounded border border-edge bg-surface p-1"><option value="viewer">can view</option><option value="editor">can edit</option></select><button type="button" aria-label={`Remove ${entry.email}`} onClick={() => void update({ shares: current().shares.filter(person => person.email !== entry.email) })}>Remove</button></div>}</For>
            <form class="flex gap-2" onSubmit={event => { event.preventDefault(); const address = email().trim(); if (!address) return; void update({ shares: [...current().shares, { email: address, role: 'viewer' }] }); setEmail(''); }}><button type="submit" aria-label="Add email">add</button></form>
          </section>
          <Show when={props.format === 'dataset' && !postgres()}><a aria-label="Manage access policies" href={`/a/${props.artifactId}/edit`} onClick={() => setOpen(false)}>Manage data actions ↗</a></Show>
        </>}</Show>
        <Show when={error()}><p role="alert" class="text-danger">{error()}</p></Show>
      </div>
    </div></Show>
  </>;
}
