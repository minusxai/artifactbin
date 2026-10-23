/* @jsxImportSource solid-js */
/** Editor geometry and view navigation, shared by hosted, preview and portable-file adapters. */
import { createMemo, type JSX } from 'solid-js';
import { Tabs } from '../ui/Tabs';
import { createIsPhoneViewport } from '../ui/MobileSheet';
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
