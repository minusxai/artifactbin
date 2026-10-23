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
 * (lib/islands/trusted-portal), else the body, inside its own theme host, which takes the trigger's appearance
 * (solid/ui/theme).
 */
import { children as resolveChildren, createEffect, createSignal, createUniqueId, onCleanup, Show, type JSX } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import type { Placed, Side } from '@/lib/islands/kit/popper';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { createTooltipTiming } from '@/lib/islands/kit/tooltip-core';

/** Trigger timing/ARIA stay eager; the floating positioning engine is interaction-only. */
type Popup = typeof import('./TooltipPopper');
let popupModule: Promise<Popup> | undefined;
const loadPopup = () => popupModule ??= import('./TooltipPopper').catch(error => { popupModule = undefined; throw error; });

export function Tooltip(props: { content: JSX.Element; children: JSX.Element; side?: Side; disabled?: boolean }): JSX.Element {
  const child = resolveChildren(() => props.children);
  const [open, setOpen] = createSignal(false);
  const [placed, setPlaced] = createSignal<Placed>();
  const id = createUniqueId();
  const [popup,setPopup] = createSignal<Popup>();
  let alive = true;
  onCleanup(() => { alive = false; });
  // A local module signal never holds the router's navigation transition.
  createEffect(() => { if (open() && !popup()) void loadPopup().then(module => { if(alive) setPopup(module); }, () => {}); });
  const { state, enter, openNow, close } = createTooltipTiming({ open, setOpen });

  const trigger = (): HTMLElement | undefined => child.toArray().find((node): node is HTMLElement => node instanceof HTMLElement);
  createEffect(() => {
    const el = trigger();
    if (!el || props.disabled) return;
    let pointerDown = false; let moved = false;
    const handlers: Array<[string, EventListener]> = [
      ['pointermove', (e) => { if ((e as PointerEvent).pointerType !== 'touch' && !moved) { void loadPopup().catch(() => {}); enter(); moved = true; } }],
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
        <Show when={popup()} fallback={<span role="tooltip" id={id} class="sr-only">{props.content}</span>}>{loaded => <Dynamic component={loaded().default} anchor={trigger()} id={id} side={props.side ?? 'top'} placed={placed} setPlaced={setPlaced}>{props.content}</Dynamic>}</Show>
      </Portal>
    </Show>
  </>;
}
