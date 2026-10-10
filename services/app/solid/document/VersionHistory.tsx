/* @jsxImportSource solid-js */
/**
 * The version list: the live document as a row of its own, then
 * every earlier version; a row previews, and only the row you are looking at offers restore. A side
 * drawer on a wide window, the edit panel's History tab (`embedded`), a half bottom sheet below the
 * panel breakpoint or on a phone.
 */
import { For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import Eye from 'lucide-solid/icons/eye';
import RotateCcw from 'lucide-solid/icons/rotate-ccw';
import X from 'lucide-solid/icons/x';
import { timeAgo } from '../ui/ui';
import { Tooltip } from '../ui/Tooltip';
import MobileSheet, { isPhoneViewport } from '../ui/MobileSheet';
import type { ArtifactVersionSummary } from '@/lib/artifact-backend/types';

interface VersionHistoryProps {
  versions: ArtifactVersionSummary[]; currentVersion: number; previewing: number | null;
  onPreview: (version: number) => void; onRestore: (version: number) => void;
  onBackToCurrent: () => void; onClose: () => void; busy: boolean;
  topOffset?: number; embedded?: boolean; sheet?: boolean;
}
const ROW = (selected: boolean) =>
  `border-b border-edge px-3 py-2.5 transition-colors ${selected ? 'border-l-2 border-l-accent bg-accent-soft' : 'border-l-2 border-l-transparent hover:bg-raised'}`;

export function VersionHistory(props: VersionHistoryProps): JSX.Element {
  onMount(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });
  const head = () => <header class="flex items-center justify-between border-b border-edge px-3 py-2">
    <span class="font-mono text-xs font-semibold text-fg">history</span>
    <Tooltip content="close"><button type="button" aria-label="Close version history" onClick={() => props.onClose()} class="cursor-pointer rounded p-1 text-muted hover:text-fg"><X size={13} /></button></Tooltip>
  </header>;
  const content = () => <>
    <div class="flex-1 overflow-y-auto">
      <button type="button" aria-label="Show the current version" onClick={() => props.onBackToCurrent()} class={`flex w-full items-baseline justify-between text-left ${ROW(props.previewing === null)}`}>
        <span class={`font-mono text-xs font-semibold ${props.previewing === null ? 'text-accent' : 'text-fg'}`}>v{props.currentVersion}</span>
        <span class="font-mono text-[10px] text-muted">current</span>
      </button>
      <Show when={props.versions.length === 0}><p class="px-3 py-3 font-mono text-[11px] text-muted">no earlier versions yet.</p></Show>
      <For each={props.versions}>{(version) => {
        const selected = () => props.previewing === version.version;
        return <div role="button" tabIndex={0} aria-label={`Preview version ${version.version}`} aria-pressed={selected()}
          onClick={() => props.onPreview(version.version)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onPreview(version.version); } }}
          class={`group cursor-pointer ${ROW(selected())}`}>
          <div class="flex min-w-0 items-baseline gap-1.5">
            <span class={`shrink-0 font-mono text-xs ${selected() ? 'font-semibold text-accent' : 'text-fg'}`}>v{version.version}</span>
            <Show when={version.title}><span class="truncate font-sans text-[11px] text-muted">· {version.title}</span></Show>
            <span class="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted">
              <Eye size={11} aria-hidden="true" class={`transition-opacity ${selected() ? 'opacity-0' : 'opacity-0 group-hover:opacity-70'}`} />
              <Show when={version.by}><span aria-label={`Version ${version.version} by ${version.by}`}>@{version.by} ·</span></Show>
              {timeAgo(version.created_at)}
            </span>
          </div>
          <Show when={selected()}>
            <button type="button" aria-label={`Restore version ${version.version}`} disabled={props.busy}
              onClick={(event) => { event.stopPropagation(); props.onRestore(version.version); }}
              class="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-[4px] border border-accent/40 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:bg-accent/10 disabled:opacity-50">
              <RotateCcw size={11} /> restore
            </button>
          </Show>
        </div>;
      }}</For>
    </div>
    <p class="border-t border-edge px-3 py-2 font-mono text-[10px] leading-relaxed text-muted">Restoring creates a new version and keeps the current version in history.</p>
  </>;
  if (isPhoneViewport() || props.sheet) {
    return <MobileSheet label="Version history" onClose={() => props.onClose()} size="half" header={head()} swipeToClose={props.sheet}>
      <div class="flex flex-col">{content()}</div>
    </MobileSheet>;
  }
  if (props.embedded) return <section aria-label="Version history" class="flex min-h-0 flex-1 flex-col overflow-y-auto">{content()}</section>;
  return <aside aria-label="Version history" class="fixed right-0 bottom-0 z-20 flex w-64 flex-col border-l border-edge bg-surface shadow-xl" style={{ top: `${props.topOffset ?? 0}px` }}>
    {head()}{content()}
  </aside>;
}
