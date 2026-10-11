/* @jsxImportSource solid-js */
/**
 * THE TAB STRIP. `role="tablist"` of `role="tab"` buttons with a roving tabindex: only the selected tab is a
 * Tab stop; the arrow keys of its `orientation` (Left/Right, or Up/Down for a vertical strip; wrapping), Home and
 * End move to and select the next enabled tab. `underline` sits on a rule under the strip; `segmented` is a
 * pill group of the same control height; `pill` tints the selected tab (an editor panel's strip).
 *
 * A tab may carry an `icon` (a function returning the element, so it is built per read), an `ariaLabel` when its
 * accessible name differs from its text, a `badge` (`true` draws the "something new" dot), a `tooltip`, the
 * `controls` id of its tabpanel and an `id` for that panel's `aria-labelledby`. A `disabled` tab says why with
 * `disabledReason`: its accessible description, and the tooltip of a wrapper (a disabled button gets no
 * pointer events). `iconOnly` hides every label, which then names the tab and becomes its tooltip.
 */
import { createUniqueId, For, Show, type JSX } from 'solid-js';
import { DISABLED, type ControlSize } from './control-styles';
import { Tooltip } from './Tooltip';

interface TabItem {
  value: string;
  label: string;
  ariaLabel?: string;
  icon?: () => JSX.Element;
  badge?: true | JSX.Element;
  tooltip?: JSX.Element;
  controls?: string;
  id?: string;
  disabled?: boolean;
  disabledReason?: string;
}
type TabVariant = 'underline' | 'segmented' | 'pill';

const STRIP: Record<TabVariant, string> = {
  underline: 'flex gap-4 border-b border-edge',
  segmented: 'inline-flex gap-0.5 rounded-control border border-edge-bright bg-raised p-0.5',
  pill: 'flex gap-0.5',
};
const VERTICAL: Record<TabVariant, string> = {
  underline: 'flex flex-col gap-1 border-r border-edge',
  segmented: 'inline-flex flex-col gap-0.5 rounded-control border border-edge-bright bg-raised p-0.5',
  pill: 'flex flex-col gap-1',
};
const TAB_SIZE: Record<TabVariant, Record<ControlSize, string>> = {
  underline: { md: 'h-control px-1 font-sans text-sm', sm: 'h-control-sm px-1 font-mono text-xs' },
  segmented: { md: 'h-[calc(var(--spacing-control)-6px)] px-3 font-sans text-sm', sm: 'h-[calc(var(--spacing-control-sm)-6px)] px-2.5 font-mono text-xs' },
  pill: { md: 'h-control-sm rounded-chip px-2.5 font-sans text-sm', sm: 'h-7 rounded-chip px-2 font-mono text-2xs' },
};
const ICON_TAB: Record<ControlSize, string> = { md: 'w-control-sm px-0', sm: 'w-7 px-0' };
const NEXT: Record<'horizontal' | 'vertical', [string, string]> = { horizontal: ['ArrowLeft', 'ArrowRight'], vertical: ['ArrowUp', 'ArrowDown'] };

export function Tabs(props: {
  label: string;
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: TabVariant;
  size?: ControlSize;
  orientation?: 'horizontal' | 'vertical';
  iconOnly?: boolean;
  class?: string;
}): JSX.Element {
  const variant = () => props.variant ?? 'underline';
  const size = () => props.size ?? 'md';
  const orientation = () => props.orientation ?? 'horizontal';
  const tone = (selected: boolean) => variant() === 'underline'
    ? `${orientation() === 'vertical' ? '-mr-px border-r-2' : '-mb-px border-b-2'} ${selected ? 'border-accent text-fg' : 'border-transparent text-muted enabled:hover:text-fg'}`
    : variant() === 'segmented'
      ? `rounded-chip ${selected ? 'bg-surface text-fg shadow-sm' : 'text-muted enabled:hover:text-fg'}`
      : selected ? 'bg-accent-soft text-accent' : 'text-muted enabled:hover:bg-raised enabled:hover:text-fg';
  const onKeyDown = (event: KeyboardEvent) => {
    const [back, forward] = NEXT[orientation()];
    if (![back, forward, 'Home', 'End'].includes(event.key)) return;
    const tabs = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')];
    if (!tabs.length) return;
    const at = tabs.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next]!.focus();
    tabs[next]!.click();
  };
  return <div role="tablist" aria-label={props.label} aria-orientation={orientation() === 'vertical' ? 'vertical' : undefined} onKeyDown={onKeyDown}
    class={`${(orientation() === 'vertical' ? VERTICAL : STRIP)[variant()]} ${props.class ?? ''}`}>
    <For each={props.items}>{(item) => {
      const selected = () => item.value === props.value;
      const reason = () => (item.disabled ? item.disabledReason : undefined);
      const reasonId = `${createUniqueId()}-reason`;
      const tip = () => item.tooltip ?? (props.iconOnly ? item.label : undefined);
      const tab = <button type="button" role="tab" id={item.id} aria-label={item.ariaLabel ?? item.label} aria-selected={selected()} aria-controls={item.controls}
        aria-describedby={reason() ? reasonId : undefined} tabIndex={selected() ? 0 : -1} disabled={item.disabled}
        onClick={() => props.onChange(item.value)}
        class={`relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${TAB_SIZE[variant()][size()]} ${props.iconOnly ? ICON_TAB[size()] : ''} ${tone(selected())} ${DISABLED}`}>
        <Show when={item.icon}>{(icon) => <span aria-hidden="true" class="inline-flex shrink-0">{icon()()}</span>}</Show>
        <Show when={!props.iconOnly}><span>{item.label}</span></Show>
        <Show when={item.badge === true}><span data-tab-dot="" aria-hidden="true" class="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent" /></Show>
        <Show when={item.badge !== undefined && item.badge !== true}><span class="inline-flex">{item.badge as JSX.Element}</span></Show>
      </button>;
      return <>
        <Show when={reason()} fallback={<Show when={tip()} fallback={tab}><Tooltip content={tip()} side={orientation() === 'vertical' ? 'left' : 'bottom'}>{tab}</Tooltip></Show>}>
          <Tooltip content={reason()} side={orientation() === 'vertical' ? 'left' : 'bottom'}><span class="inline-flex">{tab}</span></Tooltip>
          <span id={reasonId} hidden>{reason()}</span>
        </Show>
      </>;
    }}</For>
  </div>;
}
