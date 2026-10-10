/* @jsxImportSource solid-js */
/** Editor geometry and view navigation, shared by hosted, preview and portable-file adapters. */
import { For, type JSX } from 'solid-js';
import { Tooltip } from '../ui/Tooltip';
import { createIsPhoneViewport } from '../ui/MobileSheet';
import { EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story-ui/edit-bar';
export function EditorToolbar(props: { top: number; right?: number; children: JSX.Element }): JSX.Element {
  return <header aria-label="Editor toolbar" class="fixed z-30 grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[44px] items-center gap-x-1 border-b border-edge bg-surface px-2 sm:gap-x-2 sm:px-3" style={{ top: `${props.top}px`, height: `${EDIT_BAR_H}px`, left: '0px', right: `${props.right ?? 0}px` }}>{props.children}</header>;
}
interface EditorViewTab { key: string; label: string; aria: string; tip: string; icon: JSX.Element; active: boolean; disabled?: boolean; choose: () => void }
export function EditorViewTabs(props: { tabs: EditorViewTab[]; label?: string }): JSX.Element {
  return <div role="tablist" aria-label={props.label ?? "Editor view"} class="flex h-11 shrink-0 items-stretch sm:gap-1" onKeyDown={(event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    if (!tabs.length) return;
    const current = tabs.indexOf(event.target as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[index]?.focus(); tabs[index]?.click();
  }}><For each={props.tabs}>{tab => <Tooltip content={tab.tip}><button type="button" role="tab" aria-label={tab.aria} aria-selected={tab.active} disabled={tab.disabled} tabIndex={tab.active ? 0 : -1} onMouseDown={event => event.preventDefault()} onClick={tab.choose} class={`inline-flex h-11 cursor-pointer items-center gap-2 border-b-2 px-2 font-mono text-sm font-semibold transition-colors sm:px-4 disabled:cursor-default disabled:opacity-50 ${tab.active ? 'border-accent text-accent' : 'border-transparent text-muted hover:bg-raised hover:text-fg'}`}>{tab.icon}<span class="hidden sm:inline">{tab.label}</span></button></Tooltip>}</For></div>;
}

export function EditorSourcePanel(props: { top: number; commentsOpen: boolean; children: JSX.Element }): JSX.Element {
  const phone = createIsPhoneViewport();
  return <section aria-label="Source pane" class="fixed bottom-0 left-0 z-20" style={{ top: `${props.top}px`, right: `${props.commentsOpen && !phone() ? RIGHT_RAIL_W : 0}px` }}>{props.children}</section>;
}
