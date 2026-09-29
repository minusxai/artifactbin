/* @jsxImportSource solid-js */
import { createSignal, onMount, Show, type JSX } from 'solid-js';
import type { DatasetCatalog } from '@/lib/datasets/types';
interface SharingState { visibility: string; linkRole: string; shares: Array<{ email: string; role: string }>; access?: string }
export default function ShareLink(props: { artifactId?: string; title?: string; format?: string; datasetKind?: DatasetCatalog['kind']; editable?: boolean; class?: string; url?: string }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createSignal<SharingState | null>(null);
  const [email, setEmail] = createSignal('');
  const [error, setError] = createSignal('');
  onMount(() => { if (props.artifactId) void fetch(`/api/my/artifacts/${encodeURIComponent(props.artifactId)}/sharing`).then(response => response.json()).then(setState).catch(() => setError('Could not load sharing.')); });
  const update = async (patch: Record<string, unknown>) => {
    if (!props.artifactId) return;
    const response = await fetch(`/api/my/artifacts/${encodeURIComponent(props.artifactId)}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (response.ok) setState(await response.json()); else setError('Could not update sharing.');
  };
  return <>
    <button type="button" class={props.class} onClick={() => setOpen(true)}>Share</button>
    <Show when={open()}><div role="dialog" aria-modal="true" aria-label="Sharing" class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div class="w-full max-w-lg space-y-4 rounded-xl border border-edge bg-surface p-6 text-fg">
        <div class="flex justify-between"><h2 class="text-lg font-semibold">Sharing</h2><button type="button" aria-label="Close sharing" onClick={() => setOpen(false)}>Close</button></div>
        <div class="grid gap-2">
          <label class="flex gap-2"><input type="radio" name="visibility" aria-label="Make private" checked={state()?.visibility === 'private'} onChange={() => void update({ visibility: 'private' })} />Private</label>
          <label class="flex gap-2"><input type="radio" name="visibility" aria-label="Make unlisted" checked={state()?.visibility === 'unlisted'} onChange={() => void update({ visibility: 'unlisted' })} />Unlisted</label>
          <label class="flex gap-2"><input type="radio" name="visibility" aria-label="Make public" checked={state()?.visibility === 'public'} onChange={() => void update({ visibility: 'public' })} />Public</label>
          <label class="grid gap-1 text-xs">Invite email<input aria-label="Invite email" type="email" value={email()} onInput={event => setEmail(event.currentTarget.value)} class="rounded border border-edge bg-bg p-2" /></label>
          <button type="button" onClick={() => void update({ invite: { email: email(), role: 'viewer' } })}>Invite</button>
          <Show when={props.format === 'dataset'}><label class="flex gap-2"><input type="checkbox" aria-label="Allow dataset writes" checked={state()?.access === 'write'} onChange={event => void update({ access: event.currentTarget.checked ? 'write' : 'read' })} />Allow writes</label></Show>
        </div>
        <Show when={error()}><p role="alert">{error()}</p></Show>
      </div>
    </div></Show>
  </>;
}
