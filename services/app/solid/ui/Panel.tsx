/* @jsxImportSource solid-js */
/**
 * THE CARD SURFACE. A Panel is the one bordered surface the app draws content on; with `label` it is a named
 * region (<section aria-label>), with `title` it carries a header (SectionHeading plus `actions`).
 * Every other attribute (`id`, `aria-busy`, data-*, handlers) lands on its root.
 * ListRow is one row of a list inside it: divided from the row above, never from the panel's edge.
 */
import { Show, splitProps, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SectionHeading } from './PageHeader';

const PADDING = { none: '', sm: 'p-4', md: 'p-5 sm:p-6' } as const;

type PanelProps = Omit<JSX.HTMLAttributes<HTMLElement>, 'title' | 'class' | 'children'> & { label?: string; title?: JSX.Element; actions?: JSX.Element; padding?: keyof typeof PADDING; class?: string; children: JSX.Element };

export function Panel(props: PanelProps): JSX.Element {
  const [own, rest] = splitProps(props, ['label', 'title', 'actions', 'padding', 'class', 'children']);
  return <Dynamic component={own.label ? 'section' : 'div'} {...rest} aria-label={own.label}
    class={`min-w-0 rounded-panel border border-edge bg-surface ${PADDING[own.padding ?? 'md']} ${own.class ?? ''}`}>
    <Show when={own.title || own.actions}>
      <header class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Show when={own.title}><SectionHeading>{own.title}</SectionHeading></Show>
        <Show when={own.actions}><div class="flex flex-wrap items-center gap-2">{own.actions}</div></Show>
      </header>
    </Show>
    {own.children}
  </Dynamic>;
}

export function ListRow(props: { class?: string; children: JSX.Element }): JSX.Element {
  return <li class={`flex flex-wrap items-center gap-3 border-t border-edge py-3 font-sans text-sm first:border-t-0 ${props.class ?? ''}`}>{props.children}</li>;
}
