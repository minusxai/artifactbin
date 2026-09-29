/* @jsxImportSource solid-js */
import { createSignal, onMount, Show, type JSX } from 'solid-js';
export function DatasetPolicies(props: { artifactId: string; expanded?: boolean }): JSX.Element {
  const [open, setOpen] = createSignal(Boolean(props.expanded));
  const [error, setError] = createSignal('');
  onMount(() => { void fetch(`/api/my/artifacts/${encodeURIComponent(props.artifactId)}/policy`).then(response => { if (!response.ok) setError('Could not load access policies.'); }).catch(() => setError('Could not load access policies.')); });
  return <section aria-label="Dataset access policies" class="rounded border border-edge bg-surface p-4">
    <Show when={!props.expanded}><button type="button" aria-expanded={open()} onClick={() => setOpen(value => !value)}>Manage access policies</button></Show>
    <Show when={open()}><><h2 class="text-sm font-semibold">Access policies</h2><Show when={error()}><p role="alert">{error()}</p></Show></></Show>
  </section>;
}
