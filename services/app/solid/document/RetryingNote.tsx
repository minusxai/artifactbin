/* @jsxImportSource solid-js */
/** A quiet "retrying…" while a comment write waits out a brief outage; the draft stays where it is. */
import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import type { ArtifactBackend } from '@/lib/artifact-backend';

export function RetryingNote(props: { backend: ArtifactBackend; active: boolean }): JSX.Element {
  const [retrying, setRetrying] = createSignal(false);
  const stop = props.backend.watchRetrying?.(setRetrying);
  onCleanup(() => stop?.());
  return <Show when={props.active && retrying()}><p role="status" class="text-xs text-muted">retrying…</p></Show>;
}
