/* @jsxImportSource solid-js */
/**
 * A click-toggle popover anchored to its trigger and portalled out of the document flow — the Solid
 * counterpart of a Radix popover. A scrolling toolbar or a clipped rail must not clip the panel (the same
 * reason AnchoredPanel gives for its own portal), so it is placed with the framework-free Radix popper
 * model the islands and solid/components/Tooltip already use, and portalled to the trusted UI host
 * when the page has one, else <body>.
 *
 * The caller owns `open`; this owns placement and dismissal through the kit's one popup contract
 * (lib/islands/kit/popup-dismiss): an outside pointerdown or Escape reports a close, and opening one
 * closes any other open popup. Opening never steals focus from the trigger (Radix's onOpenAutoFocus prevented) — a
 * field inside the panel that wants focus asks for it itself (the `autofocus` attribute, or a ref).
 */
import { createEffect, createSignal, createUniqueId, on, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { placePopper, type Align, type Side } from '@/lib/islands/kit/popper';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { popupDismiss } from '@/lib/islands/kit/popup-dismiss';

export interface PopoverTriggerAttrs {
  ref: (el: HTMLElement) => void;
  'aria-haspopup': 'true';
  'aria-expanded': boolean;
}

export function Popover(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the trigger; spread the given attrs onto the real trigger element. */
  trigger: (attrs: PopoverTriggerAttrs) => JSX.Element;
  /** Accessible name of the panel. */
  label: string;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  /** Extra classes on the panel surface. */
  class?: string;
  /** role="listbox" for a select-style panel; omitted (plain group) for a menu of controls. */
  role?: 'listbox';
  onPanelKeyDown?: (event: KeyboardEvent) => void;
  children: JSX.Element;
}): JSX.Element {
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const [panel, setPanel] = createSignal<HTMLElement>();
  const id = createUniqueId();
  const announce = popupDismiss(() => props.open, () => props.onOpenChange(false), anchor, panel);
  createEffect(on(() => props.open, (open) => { if (open) announce(); }));
  return (
    <>
      {props.trigger({ ref: setAnchor, 'aria-haspopup': 'true', 'aria-expanded': props.open })}
      <Show when={props.open}>
        <Portal mount={trustedPortalOf(document) ?? document.body}>
          <PopoverPanel
            anchor={() => anchor()!}
            ref={setPanel}
            id={id}
            label={props.label}
            side={props.side ?? 'bottom'}
            align={props.align ?? 'start'}
            sideOffset={props.sideOffset ?? 4}
            class={props.class}
            role={props.role}
            onKeyDown={props.onPanelKeyDown}
          >
            {props.children}
          </PopoverPanel>
        </Portal>
      </Show>
    </>
  );
}

function PopoverPanel(p: {
  anchor: () => HTMLElement;
  id: string;
  label: string;
  side: Side;
  align: Align;
  sideOffset: number;
  class?: string;
  role?: 'listbox';
  onKeyDown?: (event: KeyboardEvent) => void;
  ref: (el: HTMLElement) => void;
  children: JSX.Element;
}): JSX.Element {
  let wrapper!: HTMLDivElement;
  createEffect(() => {
    const anchor = p.anchor();
    if (!anchor) return;
    const stop = placePopper(anchor, wrapper, null, {
      side: p.side, align: p.align, sideOffset: p.sideOffset, collisionPadding: 8, arrowWidth: 0, arrowHeight: 0,
      onPlaced: () => {},
    });
    onCleanup(stop);
  });
  return (
    <div data-mx-theme-host="">
      <div
        ref={(el) => { wrapper = el; p.ref(el); }}
        data-story-popper-wrapper=""
        style={{ position: 'fixed', left: '0px', top: '0px', transform: 'translate(0, -200%)', 'min-width': 'max-content', 'z-index': '200' }}
      >
        <div
          id={p.id}
          role={p.role}
          aria-label={p.label}
          data-story-floating=""
          onKeyDown={p.onKeyDown}
          class={`border border-edge bg-surface shadow-lg ${p.class ?? ''}`}
        >
          {p.children}
        </div>
      </div>
    </div>
  );
}
