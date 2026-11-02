import { onCleanup, onMount } from 'solid-js';

/**
 * THE MODAL CONTRACT, ONCE — what every app dialog and sheet owns while it is mounted:
 *  - Escape closes the TOP dialog only (a confirm over the sharing dialog closes the confirm), and
 *    never one an inner popup already handled (`defaultPrevented`, or stopped before the window);
 *  - Tab wraps inside the panel, pulling focus back in when it has left;
 *  - optional initial focus, focus restored on close (the deep active element, so a dialog opened
 *    from inside a trusted shadow root returns there, not to its host);
 *  - optional body scroll lock, counted so stacked dialogs restore the page's own value.
 * Call it inside the dialog's own owner (the component, or a `<Show>` callback child) so it lives
 * exactly as long as the dialog is on screen. Placement (portal, backdrop, z-index) stays the caller's.
 */
interface DialogShellOptions {
  panel: () => HTMLElement | undefined;
  /** Escape; the caller decides whether it may close now (a busy dialog ignores it). */
  onClose: () => void;
  initialFocus?: () => HTMLElement | null | undefined;
  lockScroll?: boolean;
  /** Tab stops; defaults to the enabled native controls and positive tab indexes. */
  focusable?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const stack: DialogShellOptions[] = [];
let locks = 0;
let unlockedOverflow = '';

const deepActive = (doc: Document): Element | null => {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
};

function onKey(event: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    if (event.defaultPrevented) return;
    event.preventDefault();
    top.onClose();
    return;
  }
  if (event.key !== 'Tab') return;
  const root = top.panel();
  if (!root) return;
  const stops = [...root.querySelectorAll<HTMLElement>(top.focusable ?? FOCUSABLE)];
  if (!stops.length) { event.preventDefault(); return; }
  const first = stops[0]!; const last = stops[stops.length - 1]!;
  const active = (root.getRootNode() as Document | ShadowRoot).activeElement;
  if (!active || !root.contains(active) || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

export function createDialogShell(options: DialogShellOptions): void {
  onMount(() => {
    const previous = deepActive(document) as HTMLElement | null;
    stack.push(options);
    if (stack.length === 1) window.addEventListener('keydown', onKey);
    if (options.lockScroll) {
      if (locks++ === 0) { unlockedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    }
    options.initialFocus?.()?.focus();
    onCleanup(() => {
      const at = stack.indexOf(options);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length === 0) window.removeEventListener('keydown', onKey);
      if (options.lockScroll && --locks === 0) document.body.style.overflow = unlockedOverflow;
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus();
    });
  });
}
