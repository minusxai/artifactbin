/* @jsxImportSource solid-js */
/**
 * THE SELECTABLE LIST: rows you pick one of — a document's versions, the agent sessions in a sidebar. Each row
 * is a full-width, left-aligned, two-line control (`title`, then `meta`) named by `label`: a button with
 * `aria-pressed` and `onSelect`, or with `href` a link (`aria-current` when selected). Selected rows take the
 * accent tint. `children` (a selected row's Restore action, say) sit beside the control in the same row, never
 * inside it, so they stay their own buttons; `trailing` sits at the end of the control's first line.
 */
import { Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { FOCUS_RING } from './control-styles';

export function SelectableList(props: { label: string; class?: string; children: JSX.Element }): JSX.Element {
  return <ul aria-label={props.label} class={`flex flex-col gap-0.5 ${props.class ?? ''}`}>{props.children}</ul>;
}

export function SelectableItem(props: {
  label: string;
  title: JSX.Element;
  meta?: JSX.Element;
  trailing?: JSX.Element;
  selected?: boolean;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  class?: string;
  children?: JSX.Element;
}): JSX.Element {
  const link = () => props.href !== undefined;
  return <li class={`rounded-control ${props.selected ? 'bg-accent-soft' : ''} ${props.class ?? ''}`}>
    <Dynamic component={link() ? 'a' : 'button'} type={link() ? undefined : 'button'} href={props.href}
      aria-label={props.label}
      aria-pressed={link() ? undefined : !!props.selected}
      aria-current={link() && props.selected ? 'true' : undefined}
      disabled={link() ? undefined : props.disabled}
      onClick={() => props.onSelect?.()}
      class={`flex w-full min-w-0 cursor-pointer flex-col items-stretch gap-0.5 rounded-control border-0 px-3 py-2 text-left font-sans no-underline transition-colors ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50 ${props.selected ? 'bg-accent-soft text-accent' : 'bg-transparent text-fg hover:bg-raised'}`}>
      <span class="flex min-w-0 items-baseline gap-2">
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{props.title}</span>
        <Show when={props.trailing}><span class="shrink-0 font-mono text-2xs text-muted">{props.trailing}</span></Show>
      </span>
      <Show when={props.meta}><span class="min-w-0 truncate font-mono text-2xs text-muted">{props.meta}</span></Show>
    </Dynamic>
    <Show when={props.children}><div class="px-3 pb-2">{props.children}</div></Show>
  </li>;
}
