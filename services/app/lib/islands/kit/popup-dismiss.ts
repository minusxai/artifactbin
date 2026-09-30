import { createEffect, createUniqueId, onCleanup } from 'solid-js';

const OPEN = 'mx:kit-popup-open';

/** One document-wide dismissal contract for independently hydrated kit popups. */
export function popupDismiss(open: () => boolean, close: () => void, trigger: () => HTMLElement | undefined, panel: () => HTMLElement | undefined) {
  const id = createUniqueId();
  const announce = () => trigger()?.ownerDocument.dispatchEvent(new CustomEvent(OPEN, { detail: id }));
  createEffect(() => {
    if (!open()) return;
    const target = trigger();
    const doc = target?.ownerDocument;
    if (!doc) return;
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    const away = (event: Event) => {
      const node = event.composedPath();
      if (!node.includes(target!) && !node.includes(panel()!)) { close(); target?.focus(); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); target?.focus(); }
    };
    doc.addEventListener(OPEN, other);
    doc.addEventListener('pointerdown', away);
    doc.addEventListener('keydown', escape);
    onCleanup(() => {
      // A menu item that unmounts with its menu (to open a dialog) leaves focus on BODY; hand it back to the
      // trigger so whatever opens next remembers a live element to return to.
      const active = doc.activeElement;
      if (target?.isConnected && (!active || active === doc.body)) target.focus();
      doc.removeEventListener(OPEN, other);
      doc.removeEventListener('pointerdown', away);
      doc.removeEventListener('keydown', escape);
    });
  });
  return announce;
}
