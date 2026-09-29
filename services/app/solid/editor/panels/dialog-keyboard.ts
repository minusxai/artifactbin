/**
 * components/use-dialog-keyboard.ts in SOLID — a mounted dialog owns Escape, Tab
 * wrapping and the body's scroll lock. Shared by the panels/ dialogs (ImageDialog,
 * MarkdownPasteDialog); Solid effects have no dependency array, so this reruns only
 * when the dialog (re)mounts, matching the React hook's effect lifetime.
 */
import { createEffect, onCleanup } from 'solid-js';

export function useDialogKeyboard(panel: () => HTMLElement | undefined, onClose: () => void, focusable: string): void {
  createEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const root = panel();
      if (!root) return;
      const stops = [...root.querySelectorAll<HTMLElement>(focusable)];
      if (stops.length === 0) return;
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const active = (root.getRootNode() as Document | ShadowRoot).activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    });
  });
}
