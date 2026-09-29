/* @jsxImportSource solid-js */
import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import RefreshCw from 'lucide-solid/icons/refresh-cw';

interface RefreshReply {
  refreshed?: string[]; unchanged?: string[];
  failed?: Array<{ code: string; url: string; fix: string }>; error?: string;
}
function summarise(reply: RefreshReply, status: number): string[] {
  if (status === 429) return ['too many web imports this hour — try again later'];
  if (status !== 200) return [reply.error ?? `could not refresh (${status})`];
  const lines: string[] = [];
  if (reply.refreshed?.length) lines.push(`${reply.refreshed.length} refreshed`);
  else if (reply.unchanged?.length) lines.push('already up to date');
  else if (!reply.failed?.length) lines.push('this document names no external images');
  for (const failed of reply.failed ?? []) lines.push(`${failed.url} — ${failed.fix}`);
  return lines;
}

export function RefreshDocumentAssets(props: { id: string }): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<string[] | null>(null);
  let inFlight = false; let alive = true;
  onCleanup(() => { alive = false; });
  const refresh = () => {
    if (inFlight) return;
    inFlight = true; setBusy(true); setResult(null);
    void (async () => {
      try {
        const response = await fetch(`/api/my/artifacts/${encodeURIComponent(props.id)}/assets/refresh`, { method: 'POST', credentials: 'same-origin' });
        const reply = await response.json().catch(() => ({})) as RefreshReply;
        if (alive) setResult(summarise(reply, response.status));
      } catch { if (alive) setResult(['could not refresh — try again']); }
      finally { inFlight = false; if (alive) setBusy(false); }
    })();
  };
  return <>
    <button type="button" aria-label="Refresh external images" disabled={busy()} onClick={refresh} class="flex w-full items-center gap-2 rounded px-2 py-2 text-left font-mono text-xs text-muted hover:bg-raised disabled:opacity-60"><RefreshCw size={14} />{busy() ? 'refreshing…' : 'refresh external images'}</button>
    <Show when={result()}>{lines => <div role="status" aria-label="Refresh result" class="mt-1 rounded border border-edge bg-raised px-2 py-2 text-xs text-muted"><For each={lines()}>{line => <p class="break-all">{line}</p>}</For></div>}</Show>
  </>;
}
