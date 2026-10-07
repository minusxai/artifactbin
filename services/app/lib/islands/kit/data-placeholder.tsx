/* @jsxImportSource solid-js */
import { Match, Switch } from 'solid-js';

/** Presentation only: unreadable and deleted imports stay indistinguishable. */
export default function DataPlaceholder(props: { name: string; pending?: boolean; error?: string }) {
  const failure = () => props.error?.endsWith('which is unavailable — deleted, or no longer readable here')
    ? 'Data unavailable. Ask the document sharer to check dataset access.'
    : `query "${props.name}" failed: ${props.error}`;
  return <Switch fallback={`data unavailable — "$${props.name}" has no rows yet`}>
    <Match when={props.pending}><span aria-hidden="true" class="size-[22px] animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" /><span class="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">loading data…</span></Match>
    <Match when={!props.name}>{'data unavailable — bind a declared table with data="$name"'}</Match>
    <Match when={props.error}>{failure()}</Match>
  </Switch>;
}
