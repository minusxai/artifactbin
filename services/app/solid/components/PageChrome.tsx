/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
export default function PageChrome(props: { authed: boolean; anon: boolean; title: string; label: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return <aside class="fixed right-4 top-4 z-40">
    <button type="button" aria-label="Open artifact controls" aria-expanded={open()} onClick={() => setOpen(value => !value)} class="rounded border border-edge bg-surface px-3 py-2 text-xs text-fg">{props.title || 'Artifact'} ···</button>
    <Show when={open()}><div aria-label={props.label} class="absolute right-0 mt-2 w-64 rounded border border-edge bg-surface p-3 shadow-xl">{props.children}</div></Show>
  </aside>;
}
