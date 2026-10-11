/* @jsxImportSource solid-js */
/**
 * THE TAB STRIP. `role="tablist"` of `role="tab"` buttons with a roving tabindex: only the selected tab is a
 * Tab stop; ArrowLeft/ArrowRight (wrapping), Home and End move to and select the next enabled tab.
 * `underline` sits on a rule under the strip; `segmented` is a pill group of the same control height.
 */
import { For, type JSX } from 'solid-js';
import { DISABLED, type ControlSize } from './control-styles';

interface TabItem { value: string; label: string; disabled?: boolean }

const STRIP = {
  underline: 'flex gap-4 border-b border-edge',
  segmented: 'inline-flex gap-0.5 rounded-control border border-edge-bright bg-raised p-0.5',
} as const;
const TAB_SIZE: Record<'underline' | 'segmented', Record<ControlSize, string>> = {
  underline: { md: 'h-control px-1 font-sans text-sm', sm: 'h-control-sm px-1 font-mono text-xs' },
  segmented: { md: 'h-[calc(var(--spacing-control)-6px)] px-3 font-sans text-sm', sm: 'h-[calc(var(--spacing-control-sm)-6px)] px-2.5 font-mono text-xs' },
};

export function Tabs(props: { label: string; items: TabItem[]; value: string; onChange: (value: string) => void; variant?: 'underline' | 'segmented'; size?: ControlSize; class?: string }): JSX.Element {
  const variant = () => props.variant ?? 'underline';
  const tone = (selected: boolean) => variant() === 'underline'
    ? `-mb-px border-b-2 ${selected ? 'border-accent text-fg' : 'border-transparent text-muted enabled:hover:text-fg'}`
    : `rounded-chip ${selected ? 'bg-surface text-fg shadow-sm' : 'text-muted enabled:hover:text-fg'}`;
  const onKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')];
    if (!tabs.length) return;
    const at = tabs.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next]!.focus();
    tabs[next]!.click();
  };
  return <div role="tablist" aria-label={props.label} onKeyDown={onKeyDown} class={`${STRIP[variant()]} ${props.class ?? ''}`}>
    <For each={props.items}>{(item) => {
      const selected = () => item.value === props.value;
      return <button type="button" role="tab" aria-label={item.label} aria-selected={selected()} tabIndex={selected() ? 0 : -1} disabled={item.disabled}
        onClick={() => props.onChange(item.value)}
        class={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${TAB_SIZE[variant()][props.size ?? 'md']} ${tone(selected())} ${DISABLED}`}>
        {item.label}
      </button>;
    }}</For>
  </div>;
}
