/* @jsxImportSource solid-js */
/** A companion Doc uses the normal, permission-checked frame. Editing stays in its own artifact. */
import { createResource, Show, type JSX } from 'solid-js';
import ExternalLink from 'lucide-solid/icons/external-link';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { FRAME_ALLOW, FRAME_SANDBOX } from '@/lib/serving/document-frame';

export default function ContextPanel(props: { id: string; backend: ArtifactBackend }): JSX.Element {
  const offline = () => props.backend.mode === 'offline';
  const [src] = createResource(() => offline() ? false : props.id, id => props.backend.documentFrame(id));
  return <section aria-label="Context" class="flex h-full min-h-0 flex-col bg-surface">
    <header class="flex items-center justify-between gap-4 border-b border-edge px-4 py-3">
      <h2 class="font-mono text-sm font-semibold text-fg">Context</h2>
      <Show when={!offline()}>
        <a href={`/a/${props.id}`} target="_blank" rel="noreferrer" class="inline-flex items-center gap-2 text-sm text-accent hover:underline">
          Open document <ExternalLink size={14} aria-hidden="true" />
        </a>
      </Show>
    </header>
    <Show when={!offline()} fallback={<p class="p-4 text-sm text-muted">Context lives in a separate document. Open the live artifact to read it.</p>}>
      <Show when={!src.loading} fallback={<p role="status" class="p-4 text-sm text-muted">Loading context…</p>}>
        <Show when={src()} fallback={<p role="status" class="p-4 text-sm text-muted">This context document is unavailable or you do not have access.</p>}>
          {(url) => <iframe src={url()} title="Context document" sandbox={FRAME_SANDBOX} allow={FRAME_ALLOW} referrerpolicy="no-referrer" class="min-h-0 w-full flex-1 border-0" />}
        </Show>
      </Show>
    </Show>
  </section>;
}
