/* @jsxImportSource solid-js */
/**
 * A page or panel's state line: loading, empty, a notice or an error, with an optional action (a retry).
 * Loading, empty, notice and caution are `role="status"` (polite); an error is `role="alert"`. Other attributes
 * (`aria-label`, `id`, data-*) land on its root.
 */
import { Show, splitProps, type JSX } from 'solid-js';

const TONE = {
  loading: 'text-muted',
  empty: 'text-muted',
  notice: 'text-muted',
  caution: 'rounded-panel border border-caution/40 bg-caution-soft px-4 py-3 text-caution',
  error: 'rounded-panel border border-danger/40 bg-danger-soft px-4 py-3 text-danger',
} as const;

export function StatusMessage(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'children' | 'role'> & { kind: keyof typeof TONE; action?: JSX.Element; class?: string; children: JSX.Element }): JSX.Element {
  const [own, rest] = splitProps(props, ['kind', 'action', 'class', 'children']);
  return <div {...rest} role={own.kind === 'error' ? 'alert' : 'status'} aria-busy={own.kind === 'loading' || undefined}
    class={`flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-sm ${TONE[own.kind]} ${own.class ?? ''}`}>
    <span>{own.children}</span>
    <Show when={own.action}>{own.action}</Show>
  </div>;
}
