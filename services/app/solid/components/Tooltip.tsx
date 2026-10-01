/* @jsxImportSource solid-js */
/**
 * The app tooltip in Solid, compact
 * `content="…"` form only — the one every app page uses.
 *
 * Radix `asChild` merges the trigger's props and handlers INTO the child element. Solid has no
 * element cloning: the child is resolved once (`children()`), and the trigger behaviour is attached
 * to that real element — listeners and the `data-state` / `aria-describedby` attributes — for the
 * owner's lifetime. So the child may be any single element (a <button>, or the <td> the Trash table
 * wraps), as with Radix.
 *
 * Behaviour kept from Radix: opens on hover after 300ms (at once within 100ms of another closing),
 * at once on keyboard focus; closes on leave, blur, pointerdown, Escape and another tooltip opening —
 * the timing shared with the reader kit's tooltip (lib/islands/kit/tooltip-core).
 * Placement is the framework-free Radix popper model the islands already use (lib/islands/kit/popper).
 * The destination is resolved when it opens: the trusted UI portal if the page has one
 * (lib/islands/trusted-portal), else the body, inside its own theme host.
 */
import { children as resolveChildren, createEffect, createSignal, createUniqueId, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { placePopper, type Placed, type Side } from '@/lib/islands/kit/popper';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { ARROW_ORIGIN, ARROW_TRANSFORM, createTooltipTiming } from '@/lib/islands/kit/tooltip-core';

export function Tooltip(props: { content: JSX.Element; children: JSX.Element; side?: Side; disabled?: boolean }): JSX.Element {
  const child = resolveChildren(() => props.children);
  const [open, setOpen] = createSignal(false);
  const [placed, setPlaced] = createSignal<Placed>();
  const id = createUniqueId();
  const { state, enter, openNow, close } = createTooltipTiming({ open, setOpen });

  const trigger = (): HTMLElement | undefined => child.toArray().find((node): node is HTMLElement => node instanceof HTMLElement);
  createEffect(() => {
    const el = trigger();
    if (!el || props.disabled) return;
    let pointerDown = false; let moved = false;
    const handlers: Array<[string, EventListener]> = [
      ['pointermove', (e) => { if ((e as PointerEvent).pointerType !== 'touch' && !moved) { enter(); moved = true; } }],
      ['pointerleave', () => { close(); moved = false; }],
      ['pointerdown', () => { close(); pointerDown = true; document.addEventListener('pointerup', () => { pointerDown = false; }, { once: true }); }],
      ['focus', () => { if (!pointerDown) openNow(); }],
      ['blur', close],
      ['click', close],
    ];
    for (const [type, fn] of handlers) el.addEventListener(type, fn);
    onCleanup(() => { for (const [type, fn] of handlers) el.removeEventListener(type, fn); });
  });
  createEffect(() => {
    const el = trigger(); if (!el) return;
    el.setAttribute('data-state', state());
    if (open()) el.setAttribute('aria-describedby', id); else el.removeAttribute('aria-describedby');
  });

  return <>
    {child()}
    <Show when={open() && !props.disabled}>
      <Portal mount={trustedPortalOf(document) ?? document.body}>
        <TooltipPopper anchor={trigger()} id={id} side={props.side ?? 'top'} placed={placed} setPlaced={setPlaced}>{props.content}</TooltipPopper>
      </Portal>
    </Show>
  </>;
}

function TooltipPopper(p: { anchor: HTMLElement | undefined; id: string; side: Side; placed: () => Placed | undefined; setPlaced: (placed: Placed | undefined) => void; children: JSX.Element }): JSX.Element {
  let wrapper!: HTMLDivElement; let arrow!: HTMLSpanElement;
  createEffect(() => {
    if (!p.anchor) return;
    const stop = placePopper(p.anchor, wrapper, arrow, { side: p.side, align: 'center', sideOffset: 6, collisionPadding: 8, arrowWidth: 10, arrowHeight: 5, onPlaced: p.setPlaced });
    onCleanup(() => { stop(); p.setPlaced(undefined); });
  });
  const side = () => p.placed()?.side ?? p.side;
  return <div data-mx-theme-host="">
    <div ref={wrapper} data-radix-popper-content-wrapper="" style={{ position: 'fixed', left: '0px', top: '0px', transform: 'translate(0, -200%)', 'min-width': 'max-content', 'z-index': '100' }}>
      <div role="tooltip" id={p.id} data-side={p.placed()?.side} data-slot="tooltip-content" data-story-floating=""
        class="pointer-events-none z-[100] w-max max-w-[min(28rem,calc(100vw-1rem))] whitespace-normal rounded-md border border-edge-bright bg-surface px-2.5 py-1.5 text-left text-xs leading-normal text-fg shadow-md">
        {p.children}
        <span ref={arrow} style={{ position: 'absolute', left: side() === 'right' ? '0px' : p.placed()?.arrowX !== undefined ? `${p.placed()!.arrowX}px` : undefined, top: side() === 'bottom' ? '0px' : p.placed()?.arrowY !== undefined ? `${p.placed()!.arrowY}px` : undefined, right: side() === 'left' ? '0px' : undefined, bottom: side() === 'top' ? '0px' : undefined, 'transform-origin': ARROW_ORIGIN[side()] || undefined, transform: ARROW_TRANSFORM[side()], visibility: p.placed()?.hideArrow ? 'hidden' : undefined }}>
          <svg stroke="var(--color-edge-bright)" stroke-width="1" stroke-linejoin="round" class="z-[100] fill-surface" width="10" height="5" viewBox="0 0 30 10" preserveAspectRatio="none" style={{ display: 'block' }}><polygon points="0,0 30,0 15,10" /></svg>
        </span>
      </div>
    </div>
  </div>;
}
