import type { IslandDocument } from '@/lib/islands/contract';
import { islandDocumentOf } from '@/lib/islands/handover';
import { PAGE_TAKEOVER_EVENT } from '@/lib/islands/page-lifetime';

/** The compiled story root is captured before the SPA mounts and moved without rerendering. */
let initialStory: HTMLElement | null = null;
let initialPath = '';
let currentRoutePath = '';
let navigatedFromInitialPage = false;

function removeServedChrome(): void {
  for (const child of Array.from(document.body.children)) if (child.hasAttribute('data-mx-reader-chrome')) child.remove();
}
function revealAppRoot(): void {
  document.getElementById('root')?.removeAttribute('hidden');
}
export function captureInitialStory(): void {
  initialStory = Array.from(document.body.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-mx-inline-story')) ?? null;
  initialPath = window.location.pathname;
  currentRoutePath = initialPath;
  navigatedFromInitialPage = false;
}
export function clearInitialStoryOnRoute(pathname: string): void {
  currentRoutePath = pathname;
  if (pathname !== initialPath) {
    navigatedFromInitialPage = true;
    clearInitialStory();
  }
}
/** True only for the router's committed destination, never its outgoing page. */
export function didClientNavigateTo(pathname: string): boolean { return navigatedFromInitialPage && pathname === currentRoutePath; }
export function clearInitialStory(): void {
  if (initialStory) {
    window.dispatchEvent(new Event(PAGE_TAKEOVER_EVENT));
    islandDocumentOf(initialStory)?.dispose();
    initialStory.remove();
    initialStory = null;
    removeServedChrome();
    revealAppRoot();
  }
}
export function initialDocumentStory(): HTMLElement | null { return initialStory; }
export function initialStoryIsCompiled(): boolean { return initialStory !== null; }
export function initialIslandDocument(): IslandDocument | null { return islandDocumentOf(initialStory); }
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
