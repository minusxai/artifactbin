/* @jsxImportSource solid-js */
/**
 * A click-toggle popover anchored to its trigger and portalled out of the document flow — the Solid
 * equivalent of this app's @radix-ui/react-popover usage (components/views/story/StoryToolbarMenu,
 * components/SelectMenu). A scrolling toolbar or a clipped rail must not clip the panel (the same
 * reason AnchoredPanel gives for its own portal), so it is placed with the framework-free Radix popper
 * model the islands and solid/components/Tooltip already use, and portalled to the trusted UI host
 * when the page has one, else <body>.
 *
 * The caller owns `open`; this owns placement and dismissal: an outside pointerdown or Escape reports
 * a close, and opening never steals focus from the trigger (Radix's onOpenAutoFocus prevented) — a
 * field inside the panel that wants focus asks for it itself (the `autofocus` attribute, or a ref).
 */
import { createEffect, createUniqueId, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { placePopper, type Align, type Side } from '@/lib/islands/kit/popper';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';

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
  let anchor: HTMLElement | undefined;
  const id = createUniqueId();
  return (
    <>
      {props.trigger({ ref: (el) => { anchor = el; }, 'aria-haspopup': 'true', 'aria-expanded': props.open })}
      <Show when={props.open}>
        <Portal mount={trustedPortalOf(document) ?? document.body}>
          <PopoverPanel
            anchor={() => anchor!}
            id={id}
            label={props.label}
            side={props.side ?? 'bottom'}
            align={props.align ?? 'start'}
            sideOffset={props.sideOffset ?? 4}
            class={props.class}
            role={props.role}
            onKeyDown={props.onPanelKeyDown}
            onClose={() => props.onOpenChange(false)}
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
  onClose: () => void;
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
  createEffect(() => {
    const onDown = (event: MouseEvent) => {
      // Composed: inside a trusted shadow root a document listener sees only the host as its target.
      const path = event.composedPath();
      if (path.includes(wrapper) || (p.anchor() && path.includes(p.anchor()))) return;
      p.onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); p.onClose(); } };
    // pointerdown/mousedown, not click: closing on the SAME press that opened elsewhere would fire
    // between the trigger's mousedown and click, reopening the panel it just closed.
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    });
  });
  return (
    <div data-mx-theme-host="">
      <div
        ref={wrapper}
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
