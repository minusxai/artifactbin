/* @jsxImportSource solid-js */
import { For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import RotateCcw from 'lucide-solid/icons/rotate-ccw';
import { timeAgo } from '../components/ui';
import { Tooltip } from '../components/Tooltip';
import type { ArtifactVersionSummary } from '@/lib/story/use-versions';

export interface VersionHistoryProps {
  versions: ArtifactVersionSummary[]; currentVersion: number; previewing: number | null;
  onPreview: (version: number) => void; onRestore: (version: number) => void;
  onBackToCurrent: () => void; onClose: () => void; busy: boolean;
  topOffset?: number; embedded?: boolean; sheet?: boolean;
}
const row = (selected: boolean) => `border-b border-edge px-3 py-2.5 ${selected ? 'border-l-2 border-l-accent bg-accent-soft' : 'border-l-2 border-l-transparent hover:bg-raised'}`;
export function VersionHistory(props: VersionHistoryProps): JSX.Element {
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));
  const content = <>
    <button type="button" aria-label="Show the current version" onClick={props.onBackToCurrent} class={`flex w-full justify-between text-left ${row(props.previewing === null)}`}><span>v{props.currentVersion}</span><span>current</span></button>
    <Show when={props.versions.length === 0}><p class="px-3 py-3 font-mono text-xs text-muted">no earlier versions yet.</p></Show>
    <For each={props.versions}>{version => <div role="button" tabIndex={0} aria-label={`Preview version ${version.version}`} aria-pressed={props.previewing === version.version}
      onClick={() => props.onPreview(version.version)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onPreview(version.version); } }}
      class={`cursor-pointer ${row(props.previewing === version.version)}`}>
      <div class="flex items-baseline gap-2 text-xs"><span>v{version.version}</span><Show when={version.title}><span class="truncate text-muted">· {version.title}</span></Show><span class="ml-auto text-muted"><Show when={version.by}>@{version.by} · </Show>{timeAgo(version.created_at)}</span></div>
      <Show when={props.previewing === version.version}><button type="button" aria-label={`Restore version ${version.version}`} disabled={props.busy} onClick={event => { event.stopPropagation(); props.onRestore(version.version); }} class="mt-2 flex items-center gap-1 rounded border border-accent px-2 py-1 text-xs text-accent"><RotateCcw size={11} /> restore</button></Show>
    </div>}</For>
    <p class="border-t border-edge px-3 py-2 font-mono text-xs text-muted">restoring makes a new version — the current one is kept, so it can be undone.</p>
  </>;
  if (props.embedded) return <section aria-label="Version history" class="flex min-h-0 flex-1 flex-col overflow-y-auto">{content}</section>;
  return <aside aria-label="Version history" class={props.sheet ? 'fixed inset-x-0 bottom-0 z-30 max-h-[50vh] overflow-auto rounded-t-xl border border-edge bg-surface' : 'fixed right-0 bottom-0 z-20 flex w-64 flex-col border-l border-edge bg-surface shadow-xl'} style={props.sheet ? undefined : { top: `${props.topOffset ?? 0}px` }}>
    <header class="flex items-center justify-between border-b border-edge px-3 py-2"><span class="font-mono text-xs font-semibold">history</span><Tooltip content="close"><button type="button" aria-label="Close version history" onClick={props.onClose}>×</button></Tooltip></header>{content}
  </aside>;
}
