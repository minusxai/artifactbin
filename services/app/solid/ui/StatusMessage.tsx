/* @jsxImportSource solid-js */
/**
 * A page or panel's state line: loading, empty, a notice or an error, with an optional action (a retry).
 * Loading, empty and notice are `role="status"` (polite); an error is `role="alert"`.
 */
import { Show, type JSX } from 'solid-js';

const TONE = {
  loading: 'text-muted',
  empty: 'text-muted',
  notice: 'text-muted',
  error: 'rounded-panel border border-danger/40 bg-danger-soft px-4 py-3 text-danger',
} as const;

export function StatusMessage(props: { kind: keyof typeof TONE; action?: JSX.Element; class?: string; children: JSX.Element }): JSX.Element {
  return <div role={props.kind === 'error' ? 'alert' : 'status'} aria-busy={props.kind === 'loading' || undefined}
    class={`flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-sm ${TONE[props.kind]} ${props.class ?? ''}`}>
    <span>{props.children}</span>
    <Show when={props.action}>{props.action}</Show>
  </div>;
}
