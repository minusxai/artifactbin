/** Applying a reader's light/dark choice to a document (the framed document's bridge, lib/islands/frame-bridge). */
import { STORY_MODE_HOOK } from '@/lib/story-runtime/contract';
import { applyColorMode, persistReaderMode } from '@/lib/story-runtime/reader-mode';

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
