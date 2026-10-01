/**
 * The two reader-chrome behaviours the Solid pages share (solid/pages/Document, solid/pages/Starter):
 * applying a light/dark choice, and showing a face's initial when its picture fails.
 */
import { STORY_MODE_HOOK } from './contract';
import { applyColorMode, persistReaderMode } from './reader-mode';

/**
 * Apply a reading choice from the local settings panel or the trusted parent's
 * reader-mode message. Both update reading state and re-ink hydrated charts
 * through the runtime's private hook.
 */
export function applyReaderChoice(win: Window, doc: Document, mode: 'light' | 'dark'): void {
  applyColorMode(doc.documentElement, mode);
  persistReaderMode(win, mode);
  for (const choice of Array.from(doc.querySelectorAll<HTMLElement>('[data-mx-mode-choice]'))) {
    choice.setAttribute('aria-pressed', String(choice.dataset.mxModeChoice === mode));
  }
  const hook = (win as unknown as Record<string, unknown>)[STORY_MODE_HOOK] as
    | ((mode: 'light' | 'dark') => void)
    | undefined;
  hook?.(mode);
}

/**
 * A FACE WHOSE PICTURE FAILS SHOWS ITS INITIAL (lib/person-face). The rail's
 * faces are server strings, so there is no React `onError` to do what
 * solid/components/Avatar does: a browser paints a broken-image glyph over a sized
 * `<img alt="">` (measured in Chromium), so the picture is removed instead and
 * the initial underneath shows. A picture that already failed before this ran
 * (`complete` with no pixels) goes at once. Returns the unwiring.
 */
export function wireFaceFallback(root: ParentNode): () => void {
  const undo: Array<() => void> = [];
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('.mx-reader-face img'))) {
    if (img.complete && img.naturalWidth === 0) { img.remove(); continue; }
    const drop = () => img.remove();
    img.addEventListener('error', drop, { once: true });
    undo.push(() => img.removeEventListener('error', drop));
  }
  return () => { for (const u of undo) u(); };
}
