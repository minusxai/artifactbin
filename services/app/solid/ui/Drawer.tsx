/* @jsxImportSource solid-js */
/**
 * THE SIDE PANEL OVER A SCRIM: the app bar's menu, notifications and controls panels — a panel pinned to the
 * right under the bar (`top`), or a bottom sheet (`side="bottom"`, a phone), over a dimming scrim that closes it
 * when pressed (`scrimLabel` names that button). Portalled to the trusted UI host (else <body>) at LAYER.dialog,
 * in the appearance of its opener. It owns the modal contract (lib/islands/kit/dialog-shell): Escape closes it,
 * Tab stays inside and focus returns to the opener. `role` is what the panel is: a `dialog` (the default,
 * `aria-modal`), a `navigation` menu or a plain named `region`.
 */
import { type JSX } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { trustedPortalOf } from '@/lib/islands/trusted-portal';
import { createDialogShell } from '@/lib/islands/kit/dialog-shell';
import { LAYER } from './layers';
import { createPlacedAppearance } from './theme';

const SIDE = {
  right: 'right-3 w-80 max-w-[calc(100vw-1.5rem)] rounded-panel border p-2 mt-2 max-h-[calc(100dvh-5rem)]',
  bottom: 'inset-x-0 bottom-0 max-h-[80vh] rounded-t-dialog border-t p-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]',
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
  let panel!: HTMLElement;
  const placed = createPlacedAppearance();
  const side = () => props.side ?? 'right';
  createDialogShell({
    panel: () => panel,
    onClose: () => props.onClose(),
    initialFocus: () => (props.initialFocus ? panel.querySelector<HTMLElement>(props.initialFocus) : null),
  });
  const role = () => props.role ?? 'dialog';
  return <><span ref={placed.marker} hidden /><Portal mount={trustedPortalOf(document) ?? document.body}>
    <div data-app-appearance={placed.appearance()} class="contents">
      <button type="button" aria-label={props.scrimLabel ?? 'Close panel'} onClick={() => props.onClose()}
        style={{ top: `${props.top ?? 0}px`, 'z-index': LAYER.dialog }}
        class="fixed inset-x-0 bottom-0 cursor-default border-0 bg-black/25 p-0" />
      <Dynamic component={role() === 'navigation' ? 'nav' : 'section'} ref={(el: HTMLElement) => { panel = el; }}
        role={role() === 'dialog' ? 'dialog' : role() === 'region' ? 'region' : undefined} aria-modal={role() === 'dialog' ? 'true' : undefined} aria-label={props.label}
        style={{ top: side() === 'right' ? `${props.top ?? 0}px` : undefined, 'z-index': LAYER.dialog }}
        class={`fixed flex flex-col overflow-y-auto border-edge bg-surface font-mono text-sm text-fg shadow-xl animate-[rise_.14s_ease-out] ${SIDE[side()]} ${props.class ?? ''}`}>
        {props.children}
      </Dynamic>
    </div>
  </Portal></>;
}
