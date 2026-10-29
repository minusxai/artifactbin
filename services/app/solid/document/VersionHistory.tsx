/* @jsxImportSource solid-js */
/**
 * The version list: the live document as a row of its own, then
 * every earlier version; a row previews, and only the row you are looking at offers restore. A side
 * drawer on a wide window, the edit panel's History tab (`embedded`), a half bottom sheet below the
 * panel breakpoint or on a phone.
 */
import { For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import RotateCcw from 'lucide-solid/icons/rotate-ccw';
import X from 'lucide-solid/icons/x';
import { timeAgo } from '../ui/ui';
import { Button } from '../ui/Button';
import { SelectableItem, SelectableList } from '../ui/SelectableList';
import { Tooltip } from '../ui/Tooltip';
import MobileSheet, { isPhoneViewport } from '../ui/MobileSheet';
import type { ArtifactVersionSummary } from '@/lib/artifact-backend';

interface VersionHistoryProps {
  versions: ArtifactVersionSummary[]; currentVersion: number; previewing: number | null;
  onPreview: (version: number) => void; onRestore: (version: number) => void;
  onBackToCurrent: () => void; onClose: () => void; busy: boolean;
  topOffset?: number; embedded?: boolean; sheet?: boolean;
}
export function VersionHistory(props: VersionHistoryProps): JSX.Element {
  const restore = (version: number): JSX.Element =>
    <Button variant="secondary" size="sm" aria-label={`Restore version ${version}`} disabled={props.busy} onClick={() => props.onRestore(version)}>
      <RotateCcw size={11} /> restore
    </Button>;
  onMount(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });
  const head = () => <header class="flex items-center justify-between border-b border-edge px-3 py-2">
    <span class="font-mono text-xs font-semibold text-fg">history</span>
    <Tooltip content="close"><Button variant="ghost" size="sm" icon aria-label="Close version history" onClick={() => props.onClose()}><X size={13} /></Button></Tooltip>
  </header>;
  const content = () => <>
    <div class="flex-1 overflow-y-auto p-1">
      <SelectableList label="Versions">
        <SelectableItem label="Show the current version" title={`v${props.currentVersion}`} trailing="current" selected={props.previewing === null} onSelect={() => props.onBackToCurrent()} />
        <For each={props.versions}>{(version) => {
          const selected = () => props.previewing === version.version;
          return <SelectableItem label={`Preview version ${version.version}`} selected={selected()} onSelect={() => props.onPreview(version.version)}
            title={<>v{version.version}<Show when={version.title}><span class="font-sans font-normal text-muted"> · {version.title}</span></Show></>}
            trailing={<>{version.by ? `@${version.by} · ` : ''}{timeAgo(version.created_at)}</>}
            // A plain value, not JSX children: the row draws its Restore slot only for a truthy `children`, and JSX children are always a function.
            children={selected() ? restore(version.version) : undefined} />;
        }}</For>
      </SelectableList>
      <Show when={props.versions.length === 0}><p class="px-3 py-3 font-mono text-2xs text-muted">no earlier versions yet.</p></Show>
    </div>
    <p class="border-t border-edge px-3 py-2 font-mono text-micro leading-relaxed text-muted">Restoring creates a new version and keeps the current version in history.</p>
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
