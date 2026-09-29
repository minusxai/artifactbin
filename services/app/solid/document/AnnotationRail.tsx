/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { RIGHT_RAIL_W } from '@/lib/story/edit-bar';

export function AnnotationRail(props: { open: boolean; onClose: () => void; children: JSX.Element; topOffset?: number; rightInset?: number; host?: HTMLElement; sheet?: boolean; picking?: boolean; onSelect?: () => void }): JSX.Element {
  const body = () => <section data-capture-chrome aria-label="Annotation sidebar" class={props.sheet ? 'fixed inset-x-0 bottom-0 z-30 max-h-[50vh] overflow-auto rounded-t-xl border border-edge bg-bg p-3' : props.host ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-bg p-2.5' : 'fixed bottom-0 z-20 flex flex-col gap-2 overflow-y-auto border-l border-edge bg-bg p-2.5'}
    style={props.sheet || props.host ? undefined : { top: `${props.topOffset ?? 0}px`, right: `${props.rightInset ?? 0}px`, width: `${RIGHT_RAIL_W}px` }}>
    <header class="flex items-center justify-between border-b border-edge pb-2"><h2 class="font-mono text-xs font-semibold">comments</h2><div class="flex items-center gap-2"><Show when={props.onSelect}><button type="button" aria-label="Select" aria-pressed={props.picking} onClick={props.onSelect}>Select</button></Show><button type="button" aria-label="Close comments" onClick={props.onClose}>×</button></div></header>
    {props.children}
  </section>;
  return <Show when={props.open}><Show when={props.host} fallback={body()}>{host => <Portal mount={host()}>{body()}</Portal>}</Show></Show>;
}
