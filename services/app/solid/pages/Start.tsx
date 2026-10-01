/* @jsxImportSource solid-js */
import { replaceDocument } from '../lib/document-navigation';
import { createSignal, onMount, Show, type JSX } from 'solid-js';

/** Browser creation starts in the editor. ?agent=1 retains the external-agent
 * handoff. One POST per mounted entry; never retry an uncertain creation. */
export function StartPage(): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  onMount(() => {
    const handoff = new URLSearchParams(window.location.search).get('agent') === '1';
    void fetch(handoff ? '/api/start' : '/api/start?mode=blank', { method: 'POST' }).then(async response => {
      if (!response.ok) throw new Error('Creation failed');
      const body = await response.json() as { id?: string };
      if (!body.id) throw new Error('Missing artifact');
      replaceDocument(`/a/${encodeURIComponent(body.id)}${handoff ? '' : '/edit'}`);
    }).catch(() => setFailed(true));
  });
  return <main class="mx-auto flex min-h-[70svh] max-w-xl flex-col justify-center gap-4 px-6"><Show when={failed()} fallback={<p role="status" class="font-mono text-sm text-muted">Creating your artifact…</p>}><p role="alert">Could not create your artifact. The request may have completed; check your workspace before trying again.</p><a href="/" class="text-accent underline">Open workspace</a></Show></main>;
}
