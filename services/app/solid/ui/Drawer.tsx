/* @jsxImportSource solid-js */
/**
 * THE SIDE PANEL OVER A SCRIM: the app bar's menu, notifications and controls panels — a panel pinned to the
 * right under the bar (`top`), or a bottom sheet (`side="bottom"`, a phone), over a dimming scrim that closes it
 * when pressed (`scrimLabel` names that button). Portalled to the trusted UI host (else <body>) at LAYER.dialog,
 * in the appearance of its opener. It owns the modal contract (lib/ui-runtime/dialog-shell): Escape closes it,
 * Tab stays inside and focus returns to the opener. `role` is what the panel is: a `dialog` (the default,
 * `aria-modal`), a `navigation` menu or a plain named `region`.
 */
import type { JSX } from 'solid-js';
import { LAYER } from './layers';
import { PanelSurface } from './PanelSurface';

const SIDE = {
  right: 'right-3 w-80 max-w-[calc(100vw-1.5rem)] rounded-panel border p-2 mt-2 max-h-[calc(100dvh-5rem)]',
  bottom: 'max-h-[80vh] pb-[max(1.25rem,env(safe-area-inset-bottom))]',
} as const;

export function Drawer(props: {
  label: string;
  onClose: () => void;
  side?: keyof typeof SIDE;
  /** Where the scrim and a right panel start, in px (under the page's bar). */
  top?: number;
  scrimLabel?: string;
  role?: 'dialog' | 'navigation' | 'region';
  initialFocus?: string;
  class?: string;
  children: JSX.Element;
}): JSX.Element {
  const side = () => props.side ?? 'right';
  return <PanelSurface label={props.label} role={props.role ?? 'dialog'} placement={side()} top={props.top}
    layer={LAYER.dialog} scrim={{ label: props.scrimLabel ?? 'Close panel', layer: LAYER.dialog, shade: 'bg-black/25' }}
    initialFocus={props.initialFocus} onClose={props.onClose}
    class={`overflow-y-auto text-sm shadow-xl animate-[rise_.14s_ease-out] ${SIDE[side()]} ${props.class ?? ''}`}>
    {props.children}
  </PanelSurface>;
}
