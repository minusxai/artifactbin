/* @jsxImportSource solid-js */
/** Portalled app panel with the shared modal lifecycle, placement, appearance and optional scrim. */
import { Show, type JSX } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { createDialogShell } from '@/lib/ui-runtime/dialog-shell';
import { trustedPortalOf } from '@/lib/ui-runtime/trusted-portal';
import { createPlacedAppearance } from './theme';

export function PanelSurface(props: {
  label: string;
  role: 'dialog' | 'navigation' | 'region';
  placement: 'right' | 'bottom';
  layer: number;
  /** Top of the scrim and of a right panel. */
  top?: number;
  scrim?: { label: string; layer: number; shade: 'bg-black/25' | 'bg-black/40' };
  initialFocus?: string;
  class: string;
  onClose: () => void;
  children: JSX.Element;
}): JSX.Element {
  let panel!: HTMLElement;
  const placed = createPlacedAppearance();
  const top = () => `${props.top ?? 0}px`;
  const bottom = () => props.placement === 'bottom';
  const close = () => props.onClose();
  createDialogShell({
    panel: () => panel,
    onClose: close,
    initialFocus: () => props.initialFocus ? panel.querySelector<HTMLElement>(props.initialFocus) : null,
  });

  return <><span ref={placed.marker} hidden /><Portal mount={trustedPortalOf(document) ?? document.body}>
    <div data-app-appearance={placed.appearance()} class="contents">
      <Show when={props.scrim}>{scrim =>
        <button type="button" aria-label={scrim().label} onClick={close}
          style={{ top: top(), 'z-index': scrim().layer }}
          class={`fixed inset-x-0 bottom-0 cursor-default border-0 p-0 ${scrim().shade}`} />
      }</Show>
      <Dynamic component={props.role === 'navigation' ? 'nav' : 'section'} ref={(el: HTMLElement) => { panel = el; }}
        role={props.role === 'navigation' ? undefined : props.role}
        aria-modal={props.role === 'dialog' ? 'true' : undefined} aria-label={props.label}
        style={{ top: bottom() ? undefined : top(), 'z-index': props.layer }}
        class={`fixed flex flex-col border-edge bg-surface font-mono text-fg ${bottom() ? 'inset-x-0 bottom-0 rounded-t-dialog border-t p-3' : ''} ${props.class}`}>
        {props.children}
      </Dynamic>
    </div>
  </Portal></>;
}
