/* @jsxImportSource solid-js */
/**
 * THE NON-MODAL FLOATING CARD: a `role="dialog"` (never `aria-modal`) the caller places and moves — a comment
 * composer beside its selection, dragged by its own handle. It is portalled (trusted UI host, else <body>) at
 * LAYER.popover so the page and its bars stay usable around it, takes the appearance of where it was opened
 * (solid/ui/theme), and reports Escape from inside it through `onClose`. Not anchored to a trigger and not
 * dismissed by an outside press: it lives as long as the caller renders it.
 */
import { splitProps, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { LAYER } from './layers';
import { createPlacedAppearance } from './theme';

export function FloatingPanel(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'style' | 'role'> & {
  label: string;
  /** Viewport coordinates of the card's top-left corner, in px. */
  position: { left: number; top: number };
  width?: number;
  onClose?: () => void;
  /** An element in the context the card belongs to, for its appearance (else the focused opener). */
  anchor?: HTMLElement;
  ref?: (el: HTMLDivElement) => void;
  class?: string;
  children: JSX.Element;
}): JSX.Element {
  const [own, rest] = splitProps(props, ['label', 'position', 'width', 'onClose', 'anchor', 'ref', 'class', 'children']);
  const placed = createPlacedAppearance(() => own.anchor);
  return <>
    <span ref={placed.marker} hidden />
    <Portal mount={trustedPortalOf(document) ?? document.body}>
      <div {...rest} ref={own.ref} role="dialog" aria-label={own.label} data-app-appearance={placed.appearance()}
        onKeyDown={(event) => { if (event.key === 'Escape' && own.onClose && !event.defaultPrevented) { event.preventDefault(); own.onClose(); } }}
        style={{ position: 'fixed', left: `${own.position.left}px`, top: `${own.position.top}px`, width: own.width ? `${own.width}px` : undefined, 'z-index': LAYER.popover }}
        class={`rounded-panel border border-edge bg-surface font-sans text-fg shadow-lg ${own.class ?? ''}`}>
        {own.children}
      </div>
    </Portal>
  </>;
}
