/* @jsxImportSource solid-js */
/**
 * components/MobileSheet in SOLID — the bottom sheet a phone gets where desktop gets an anchored
 * panel. The caller decides when it is used; the sheet owns the backdrop, Escape, the grab handle,
 * the scroll cap and swipe-to-close. It portals to <body> so a fixed ancestor cannot re-anchor it.
 *
 * Open sheets are COUNTED (`subscribeSheets`): the served reader chrome steps its rail aside while
 * one is up, and comes back when the last one closes.
 */
import { createSignal, onCleanup, onMount, Show, type Accessor, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { createDialogShell } from '@/lib/islands/kit/dialog-shell';

/** Tailwind's `sm` threshold, by innerWidth (jsdom implements no media queries). */
export const isPhoneViewport = (): boolean => typeof window !== 'undefined' && window.innerWidth < 640;

/** The same answer, LIVE. */
export function createIsPhoneViewport(): Accessor<boolean> {
  const [phone, setPhone] = createSignal(isPhoneViewport());
  onMount(() => {
    const onResize = () => setPhone(isPhoneViewport());
    onResize();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });
  return phone;
}

let openSheets = 0;
const sheetListeners = new Set<(open: boolean) => void>();
const announceSheets = () => { for (const listener of sheetListeners) listener(openSheets > 0); };

/** Follow whether any sheet is open; called at once with the current answer. */
export function subscribeSheets(listener: (open: boolean) => void): () => void {
  sheetListeners.add(listener);
  listener(openSheets > 0);
  return () => { sheetListeners.delete(listener); };
}

const SWIPE_CLOSE_PX = 64;

export default function MobileSheet(props: {
  label: string;
  onClose: () => void;
  size?: 'tall' | 'half';
  header?: JSX.Element;
  swipeToClose?: boolean;
  children: JSX.Element;
}): JSX.Element {
  onMount(() => {
    openSheets += 1;
    announceSheets();
    onCleanup(() => { openSheets -= 1; announceSheets(); });
  });
  let panel: HTMLDivElement | undefined;
  createDialogShell({ panel: () => panel, onClose: () => props.onClose() });
  let dragFrom: number | null = null;
  const [dragged, setDragged] = createSignal(0);
  const onTouchStart = (event: TouchEvent) => { if (props.swipeToClose) dragFrom = event.touches[0]?.clientY ?? null; };
  const onTouchMove = (event: TouchEvent) => {
    if (!props.swipeToClose || dragFrom === null) return;
    setDragged(Math.max(0, (event.touches[0]?.clientY ?? dragFrom) - dragFrom));
  };
  const onTouchEnd = () => {
    if (!props.swipeToClose) return;
    const close = dragged() >= SWIPE_CLOSE_PX;
    dragFrom = null;
    setDragged(0);
    if (close) props.onClose();
  };
  const half = () => (props.size ?? 'tall') === 'half';
  return (
    <Portal mount={trustedPortalOf(document) ?? document.body}>
      <Show when={!half()}>
        <button type="button" aria-label="Close sheet" onClick={() => props.onClose()}
          class="fixed inset-0 z-[2147483006] cursor-default border-0 bg-black/40 p-0" />
      </Show>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={props.label}
        style={dragged() ? { transform: `translateY(${dragged()}px)` } : undefined}
        class={`fixed inset-x-0 bottom-0 z-[2147483007] ${half() ? 'max-h-[50vh]' : 'max-h-[80vh]'} flex animate-[sheet-in_.2s_ease-out] flex-col rounded-t-[10px] border-t border-edge bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] font-mono text-xs shadow-lg`}>
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          class={props.swipeToClose ? 'shrink-0 touch-none' : 'contents'}>
          <div aria-hidden="true" class="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-edge" />
          <Show when={props.header}><div class="shrink-0">{props.header}</div></Show>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">{props.children}</div>
      </div>
    </Portal>
  );
}
