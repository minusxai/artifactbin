/* @jsxImportSource solid-js */
/**
 * components/AnnotationRail in SOLID — the comment rail's FRAME, apart from the layer itself.
 *
 * The conversation has three homes: the fixed right rail on desktop (the page narrows the document
 * by its width), the editor's panel when it hosts the rail (rendered into it, not as a column of its
 * own), and a half-height bottom sheet on a phone. The content is identical; this wrapper is the
 * only thing that knows the difference. The header — title and the way out — is pinned above the
 * scroll in every home, however long the list gets.
 */
import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import MobileSheet from '../components/MobileSheet';
import { RIGHT_RAIL_W } from '@/lib/story/edit-bar';

export function RailChrome(props: {
  phone: boolean;
  /** The editor's panel, when it hosts the rail. */
  host?: HTMLElement;
  topOffset: number;
  rightInset: number;
  onClose: () => void;
  header: JSX.Element;
  children: JSX.Element;
  /** The layer's code is still arriving. */
  busy?: boolean;
}): JSX.Element {
  const ariaBusy = () => props.busy || undefined;
  return <Show when={!props.phone} fallback={
    <MobileSheet label="Annotation sidebar" onClose={props.onClose} size="half" header={props.header}>
      <div aria-busy={ariaBusy()} class="flex flex-col gap-2.5">{props.children}</div>
    </MobileSheet>
  }>
    <Show when={props.host} fallback={
      <aside data-capture-chrome aria-label="Annotation sidebar" aria-busy={ariaBusy()}
        class="fixed bottom-0 z-20 flex flex-col gap-2.5 border-l border-edge bg-bg p-2.5"
        style={{ top: `${props.topOffset}px`, right: `${props.rightInset}px`, width: `${RIGHT_RAIL_W}px` }}>
        <div class="shrink-0">{props.header}</div>
        <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{props.children}</div>
      </aside>
    }>{(host) => (
      <Portal mount={host()} ref={(wrapper: HTMLElement) => { wrapper.style.display = 'contents'; }}>
        <section data-capture-chrome aria-label="Annotation sidebar" aria-busy={ariaBusy()} class="flex min-h-0 flex-1 flex-col gap-2.5 bg-bg p-2.5">
          <div class="shrink-0">{props.header}</div>
          <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">{props.children}</div>
        </section>
      </Portal>
    )}</Show>
  </Show>;
}
