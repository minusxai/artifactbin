/* @jsxImportSource solid-js */
/** A companion Doc uses the normal, permission-checked frame. Editing stays in its own artifact. */
import { createResource, createSignal, Show, type JSX } from 'solid-js';
import ExternalLink from 'lucide-solid/icons/external-link';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { FRAME_ALLOW, FRAME_SANDBOX } from '@/lib/serving/document-frame';
import { contextDocumentId } from '@/lib/story/document/context';
import { FORM_PRIMARY_BUTTON } from '../components/FormControls';

export default function ContextPanel(props: { id: string | null; backend: ArtifactBackend; onChange: (id: string | null) => void }): JSX.Element {
  const offline = () => props.backend.mode === 'offline';
  const [editing, setEditing] = createSignal(false);
  const [input, setInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [src] = createResource(() => offline() ? false : props.id || false, id => props.backend.documentFrame(id));
  const begin = () => { setInput(props.id ? `ref:${props.id}` : ''); setError(''); setEditing(true); };
  const change = (id: string | null) => {
    try { props.onChange(id); setEditing(false); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change context.'); }
  };
  const attach = async () => {
    const id = contextDocumentId(input(), window.location.origin);
    if (!id) { setError('Enter a Doc link or ID from this server.'); return; }
    setBusy(true); setError('');
    try {
      if (!await props.backend.documentFrame(id)) { setError('Choose a document you can access.'); return; }
      change(id);
    } catch { setError('Could not load this document. Try again.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Context" class="flex h-full min-h-0 flex-col bg-surface">
    <header class="flex items-center justify-between gap-4 border-b border-edge px-4 py-3">
      <h2 class="font-mono text-sm font-semibold text-fg">Context</h2>
      <Show when={props.id && !offline()}>
        <div class="flex items-center gap-4">
          <button type="button" onClick={begin} class="cursor-pointer text-sm text-muted hover:text-fg">Change context</button>
          <a href={`/a/${props.id}`} target="_blank" rel="noreferrer" class="inline-flex items-center gap-2 text-sm text-accent hover:underline">
            Open document <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      </Show>
    </header>
    <Show when={editing()}>
      <form class="border-b border-edge p-4" onSubmit={event => { event.preventDefault(); void attach(); }}>
        <label class="block text-sm text-fg">Document link or ID
          <input value={input()} onInput={event => setInput(event.currentTarget.value)} disabled={busy()} placeholder="Paste a Doc link or ref:ID" class="mt-2 w-full rounded border border-edge bg-ground px-3 py-2" />
        </label>
        <div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <button type="submit" disabled={busy()} class={FORM_PRIMARY_BUTTON}>{busy() ? 'Checking…' : props.id ? 'Save context' : 'Add context'}</button>
          <button type="button" disabled={busy()} onClick={() => setEditing(false)} class="cursor-pointer text-muted">Cancel</button>
          <Show when={props.id}><button type="button" disabled={busy()} onClick={() => change(null)} class="cursor-pointer text-muted">Remove context</button></Show>
        </div>
        <Show when={error()}><p role="alert" class="mt-3 text-sm text-danger">{error()}</p></Show>
      </form>
    </Show>
    <Show when={props.id} fallback={<div class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p class="text-sm text-muted">No additional context</p>
      <Show when={!offline() && !editing()}><button type="button" onClick={begin} class="cursor-pointer rounded border border-edge px-4 py-2 text-sm font-semibold text-accent hover:bg-raised">Add context</button></Show>
    </div>}>
      <Show when={!offline()} fallback={<p class="p-4 text-sm text-muted">Context lives in a separate document. Open the live artifact to read it.</p>}>
        <Show when={!src.loading} fallback={<p role="status" class="p-4 text-sm text-muted">Loading context…</p>}>
          <Show when={src()} fallback={<p role="status" class="p-4 text-sm text-muted">This context document is unavailable or you do not have access.</p>}>
            {(url) => <iframe src={url()} title="Context document" sandbox={FRAME_SANDBOX} allow={FRAME_ALLOW} referrerpolicy="no-referrer" class="min-h-0 w-full flex-1 border-0" />}
          </Show>
        </Show>
      </Show>
    </Show>
  </section>;
}
