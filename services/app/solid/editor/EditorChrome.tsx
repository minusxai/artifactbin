/* @jsxImportSource solid-js */
/** Editor geometry and view navigation, shared by hosted, preview and portable-file adapters. */
import { createMemo, type JSX } from 'solid-js';
import { Tabs } from '../ui/Tabs';
import { createIsPhoneViewport } from '../ui/MobileSheet';
import { EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story-ui/edit-bar';
export function EditorToolbar(props: { top: number; right?: number; children: JSX.Element }): JSX.Element {
  return <header aria-label="Editor toolbar" class="fixed z-30 grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[44px] items-center gap-x-1 border-b border-edge bg-surface px-2 sm:gap-x-2 sm:px-3" style={{ top: `${props.top}px`, height: `${EDIT_BAR_H}px`, left: '0px', right: `${props.right ?? 0}px` }}>{props.children}</header>;
}
interface EditorViewTab { key: string; label: string; aria: string; tip: string; icon: JSX.Element; active: boolean; disabled?: boolean; choose: () => void }
/**
 * The editor's view switch. The tabs are ui/Tabs; labels collapse to icons (named and tooltipped by their label) on a
 * phone. A press must not take focus from the document being edited, so the strip cancels the mouse-down default.
 */
export function EditorViewTabs(props: { tabs: EditorViewTab[]; label?: string }): JSX.Element {
  const phone = createIsPhoneViewport();
  const named = (key: string) => props.tabs.find(tab => tab.key === key);
  // The parent rebuilds its tab list on every state change; the strip is rebuilt only when what it SHOWS changes,
  // so a keyboard move keeps focus on the tab it just selected.
  const items = createMemo(() => props.tabs.map(tab => ({ value: tab.key, label: tab.label, ariaLabel: tab.aria, tooltip: tab.tip, disabled: tab.disabled })),
    undefined, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  return <div class="flex shrink-0" onMouseDown={event => event.preventDefault()}>
    <Tabs label={props.label ?? 'Editor view'} iconOnly={phone()} value={props.tabs.find(tab => tab.active)?.key ?? ''}
      onChange={key => named(key)?.choose()}
      items={items().map(item => ({ ...item, icon: () => named(item.value)?.icon }))} />
  </div>;
}

export function EditorSourcePanel(props: { top: number; commentsOpen: boolean; children: JSX.Element }): JSX.Element {
  const phone = createIsPhoneViewport();
  return <section aria-label="Source pane" class="fixed bottom-0 left-0 z-20" style={{ top: `${props.top}px`, right: `${props.commentsOpen && !phone() ? RIGHT_RAIL_W : 0}px` }}>{props.children}</section>;
}
