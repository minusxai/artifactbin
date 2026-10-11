/* @jsxImportSource solid-js */
/**
 * THE CARD SURFACE. A Panel is the one bordered surface the app draws content on; with `label` it is a named
 * region (<section aria-label>), with `title` it carries a header (SectionHeading plus `actions`).
 * ListRow is one row of a list inside it: divided from the row above, never from the panel's edge.
 */
import { Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SectionHeading } from './PageHeader';

const PADDING = { none: '', sm: 'p-4', md: 'p-5 sm:p-6' } as const;

export function Panel(props: { label?: string; title?: JSX.Element; actions?: JSX.Element; padding?: keyof typeof PADDING; class?: string; children: JSX.Element }): JSX.Element {
  return <Dynamic component={props.label ? 'section' : 'div'} aria-label={props.label}
    class={`min-w-0 rounded-panel border border-edge bg-surface ${PADDING[props.padding ?? 'md']} ${props.class ?? ''}`}>
    <Show when={props.title || props.actions}>
      <header class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Show when={props.title}><SectionHeading>{props.title}</SectionHeading></Show>
        <Show when={props.actions}><div class="flex flex-wrap items-center gap-2">{props.actions}</div></Show>
      </header>
    </Show>
    {props.children}
  </Dynamic>;
}

export function ListRow(props: { class?: string; children: JSX.Element }): JSX.Element {
  return <li class={`flex flex-wrap items-center gap-3 border-t border-edge py-3 font-sans text-sm first:border-t-0 ${props.class ?? ''}`}>{props.children}</li>;
}
