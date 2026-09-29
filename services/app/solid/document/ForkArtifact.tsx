/* @jsxImportSource solid-js */
import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import GitFork from 'lucide-solid/icons/git-fork';
import { loginHref } from '@/lib/login-href';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Tooltip } from '../components/Tooltip';

type Dataset = { id: string; title: string | null };
export function copiedDatasetsNote(datasets: Dataset[]): string | null {
  const first = datasets[0];
  if (!first) return null;
  return datasets.length === 1 ? `Its dataset “${first.title ?? first.id}” will be copied too` : `Its ${datasets.length} datasets will be copied too`;
}

export interface ForkProps { id: string; title?: string | null; variant?: 'menu' | 'bar'; navigate?: (href: string) => void }
const go = (href: string) => { window.location.assign(href); };

export function ForkConfirm(props: ForkProps & { onClose: () => void }): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [datasets, setDatasets] = createSignal<Dataset[] | null>(null);
  const [refusal, setRefusal] = createSignal<string[] | null>(null);
  let active = true;
  let inFlight = false;
  onCleanup(() => { active = false; });
  onMount(() => {
    void fetch(`/api/my/artifacts/${encodeURIComponent(props.id)}/fork`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true }),
    }).then(async response => {
      if (!response.ok) return;
      const body = await response.json() as { datasets?: Dataset[] };
      if (active && Array.isArray(body.datasets)) setDatasets(body.datasets);
    }).catch(() => {});
  });
  const navigate = (href: string) => (props.navigate ?? go)(href);
  const fork = () => {
    if (inFlight) return;
    inFlight = true; setBusy(true); setRefusal(null);
    let leaving = false;
    void (async () => {
      try {
        const response = await fetch(`/api/my/artifacts/${encodeURIComponent(props.id)}/fork`, { method: 'POST', credentials: 'same-origin' });
        const body = await response.json().catch(() => ({})) as { url?: string; error?: string; details?: string[] };
        if (!active) return;
        if (response.status === 201 && body.url) {
          leaving = true;
          const url = new URL(body.url, location.href);
          navigate(url.pathname + url.search);
          return;
        }
        if (response.status === 401 || (response.status === 409 && body.error === 'sign_in_required')) {
          leaving = true; navigate(loginHref(location, 'fork')); return;
        }
        setRefusal([...new Set(body.details?.length ? body.details : [body.error ?? `could not fork (${response.status})`])]);
      } catch { if (active) setRefusal(['could not fork — try again']); }
      finally { if (!leaving && active) { inFlight = false; setBusy(false); } }
    })();
  };
  return <ConfirmDialog title="Fork this artifact?" description={<>
    <p>{`A copy of “${props.title ?? 'this artifact'}” will be added to your artifacts. You’ll open the new copy after forking. Comments, history and sharing stay with the original.`}</p>
    <Show when={datasets() && copiedDatasetsNote(datasets()!)}><p aria-label="Datasets this fork copies" role="status" class="mt-3 rounded border border-edge bg-raised px-2 py-2 text-xs text-muted">{copiedDatasetsNote(datasets()!)}</p></Show>
    <Show when={refusal()}>{lines => <div aria-label="Fork refused" role="status" class="mt-3 rounded border border-edge bg-raised px-2 py-2 text-xs text-muted"><For each={lines()}>{line => <p class="whitespace-pre-wrap">{line}</p>}</For><button type="button" aria-label="Dismiss fork refusal" onClick={() => setRefusal(null)}>dismiss</button></div>}</Show>
  </>}
    action="Fork and open copy" confirmLabel="Confirm fork" cancelLabel="Cancel fork" busy={busy()} onConfirm={fork} onCancel={props.onClose} />;
}

export function ForkArtifact(props: ForkProps): JSX.Element {
  const [asked, setAsked] = createSignal(false);
  return <div class="relative"><Tooltip content="Fork artifact"><button type="button" aria-label="Fork artifact" onClick={() => setAsked(true)}
    class={props.variant === 'bar' ? 'flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-raised' : 'flex w-full items-center gap-2 rounded px-2 py-2 text-left font-mono text-xs text-muted hover:bg-raised'}>
    <GitFork size={14} /><span class={props.variant === 'bar' ? 'sr-only' : ''}>fork</span></button></Tooltip>
    <Show when={asked()}><ForkConfirm {...props} onClose={() => setAsked(false)} /></Show>
  </div>;
}
