/* @jsxImportSource solid-js */
/**
 * A companion Doc uses the normal, permission-checked frame. Editing stays in its own artifact.
 * The frame's `title=` is its accessible name (not a tooltip) and the name the editor gate selects it by: it stays.
 */
import { createResource, createSignal, Show, type JSX } from 'solid-js';
import ExternalLink from 'lucide-solid/icons/external-link';
import type { ArtifactBackend } from '@/lib/artifact-backend';
import { FRAME_ALLOW, FRAME_SANDBOX } from '@/lib/document-serving/document-frame';
import { LINK } from '../ui/ui';
import { contextDocumentId } from '@/lib/document/context';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { SectionHeading } from '../ui/PageHeader';
import { StatusMessage } from '../ui/StatusMessage';

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
      <SectionHeading>Context</SectionHeading>
      <Show when={props.id && !offline() && !editing()}>
        <div class="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={begin}>Change context</Button>
          <a href={`/a/${props.id}`} target="_blank" rel="noreferrer" class={`inline-flex items-center gap-2 text-sm ${LINK}`}>
            Open document <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      </Show>
    </header>
    <Show when={editing()}>
      <div class="flex min-h-0 flex-1 overflow-y-auto px-6 py-10 sm:px-10">
        <form class="m-auto w-full max-w-md" onSubmit={event => { event.preventDefault(); void attach(); }}>
          <SectionHeading>{props.id ? 'Change context' : 'Add context'}</SectionHeading>
          <p class="mt-2 text-sm leading-6 text-muted">Link a Doc with notes, sources, or background for this artifact.</p>
          <Field label="Artifact link" class="mt-6">
            <Input value={input()} onInput={event => setInput(event.currentTarget.value)} disabled={busy()} placeholder="Paste a Doc link" />
          </Field>
          <div class="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy()}>{busy() ? 'Checking…' : props.id ? 'Save context' : 'Add context'}</Button>
            <Button variant="ghost" disabled={busy()} onClick={() => setEditing(false)}>Cancel</Button>
            <Show when={props.id}><Button variant="ghost" disabled={busy()} onClick={() => change(null)}>Remove context</Button></Show>
          </div>
          <Show when={error()}><StatusMessage kind="error" class="mt-3">{error()}</StatusMessage></Show>
        </form>
      </div>
    </Show>
    <Show when={!editing()}>
      <Show when={props.id} fallback={<div class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <StatusMessage kind="empty">No additional context</StatusMessage>
        <Show when={!offline()}><Button variant="secondary" onClick={begin}>Add context</Button></Show>
      </div>}>
        <Show when={!offline()} fallback={<StatusMessage kind="notice" class="p-4">Context lives in a separate document. Open the live artifact to read it.</StatusMessage>}>
          <Show when={!src.loading} fallback={<StatusMessage kind="loading" class="p-4">Loading context…</StatusMessage>}>
            <Show when={src()} fallback={<StatusMessage kind="notice" class="p-4">This context document is unavailable or you do not have access.</StatusMessage>}>
              {(url) => <iframe src={url()} title="Context document" sandbox={FRAME_SANDBOX} allow={FRAME_ALLOW} referrerpolicy="no-referrer" class="min-h-0 w-full flex-1 border-0" />}
            </Show>
          </Show>
        </Show>
      </Show>
    </Show>
  </section>;
}
