import { islandDocumentOf } from '@/lib/islands/handover';
import { PAGE_TAKEOVER_EVENT } from '@/lib/islands/page-lifetime';

/** The compiled story root is captured before the SPA mounts and moved without rerendering. */
let initialStory: HTMLElement | null = null;
let initialPath = '';

function removeServedChrome(): void {
  for (const child of Array.from(document.body.children)) if (child.hasAttribute('data-mx-reader-chrome')) child.remove();
}
function revealAppRoot(): void {
  document.getElementById('root')?.removeAttribute('hidden');
}
/**
 * The served document's own `<head>` sheets (lib/compiled-page/assembler.ts): the reader chrome's
 * CSS, the app-bar reservation rule, the document's compiled Tailwind, and its footer. Left behind,
 * `data-mx-story-css` collides with the app shell's own utility class names (the same `hidden`/
 * `sm:*` classes, compiled independently per document) and breaks the app bar on every route the
 * SPA renders after this document — remove them with the served chrome, whether the document is
 * left before or after the app adopts it (solid/pages/Document.tsx's own unmount).
 */
export const SERVED_HEAD_STYLE_ATTRS = ['data-mx-chrome', 'data-mx-app-reserve', 'data-mx-story-css', 'data-mx-footer-css'] as const;
export function removeServedHeadStyles(): void {
  for (const attr of SERVED_HEAD_STYLE_ATTRS) document.head.querySelector(`style[${attr}]`)?.remove();
}
export function captureInitialStory(): void {
  initialStory = Array.from(document.body.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-mx-inline-story')) ?? null;
  initialPath = window.location.pathname;
}
export function clearInitialStoryOnRoute(pathname: string): void {
  if (pathname !== initialPath) {
    clearInitialStory();
  }
}
export function clearInitialStory(): void {
  if (initialStory) {
    window.dispatchEvent(new Event(PAGE_TAKEOVER_EVENT));
    islandDocumentOf(initialStory)?.dispose();
    initialStory.remove();
    initialStory = null;
    removeServedChrome();
    removeServedHeadStyles();
    revealAppRoot();
  }
}
export function initialDocumentStory(): HTMLElement | null { return initialStory; }
export function adoptInitialStory(): HTMLElement | null {
  const story = initialStory;
  initialStory = null;
  if (story) {
    window.dispatchEvent(new Event(PAGE_TAKEOVER_EVENT));
    removeServedChrome();
    revealAppRoot();
  }
  return story;
}
/** The compiled head's single sheet, handed to the editor when it opens. */
export function initialStorySheet(): string | null {
  const sheet = document.head.querySelector('style[data-mx-story-css]');
  return sheet instanceof HTMLStyleElement ? sheet.textContent : null;
}
