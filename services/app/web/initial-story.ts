import type { IslandDocument } from '@/lib/islands/contract';
import { islandDocumentOf } from '@/lib/islands/handover';

/**
 * THE SERVED DOCUMENT THE APP ADOPTS, captured before the app mounts. Two page shapes serve one:
 *
 *  - today's app page (server/app withInitialStory): the story inside a `[data-mx-initial-story]`
 *    wrapper whose handoff rule hides the empty `#root`; the inline runtime hydrates it;
 *  - the COMPILED page (lib/compiled-page/assembler, docs/phase2-architecture.md §7): the story
 *    root is the body's own child, its islands already running and its `IslandDocument` on the
 *    element (`__mxIslands`). The app moves that very element into its tree and never re-renders
 *    it; the served reader chrome beside it gives way to the app's, and the app's `#root` (created
 *    hidden by web/spa-idle) is revealed in the same step.
 */
let initialStory: Element | null = null;
let initialPath = '';
/** The captured story is a compiled page's root (no wrapper, islands, no React hydration). */
let compiled = false;
/**
 * The server's story wrapper: the body's last child carrying the attribute —
 * the page data (web/bootstrap) now rides after it, as the very last element.
 */
function servedWrapper(): Element | null {
  const children = document.body.children;
  for (let i = children.length - 1; i >= 0; i--) if (children[i]!.hasAttribute('data-mx-initial-story')) return children[i]!;
  return null;
}
/** A compiled page's story root: a body child carrying the story attribute, with no wrapper around it. */
function compiledRoot(): HTMLElement | null {
  for (const child of Array.from(document.body.children)) if (child instanceof HTMLElement && child.hasAttribute('data-mx-inline-story')) return child;
  return null;
}
/** The compiled page's server-rendered reader chrome (lib/story/reader-chrome), a body child; the app draws its own. */
function removeServedChrome(): void {
  for (const child of Array.from(document.body.children)) if (child.hasAttribute('data-mx-reader-chrome')) child.remove();
}
/** The app's root, hidden while a compiled page's story is still the body's (web/spa-idle). */
function revealAppRoot(): void {
  document.getElementById('root')?.removeAttribute('hidden');
}
export function captureInitialStory(): void {
  const wrapper = servedWrapper();
  const root = wrapper ? null : compiledRoot();
  initialStory = wrapper ?? root;
  compiled = !!root;
  initialPath = window.location.pathname;
}
/** Clear the captured server sibling before an app-route commit can paint. */
export function clearInitialStoryOnRoute(pathname: string): void {
  if (pathname !== initialPath) clearInitialStory();
}
/**
 * The served story leaves without being adopted (the reader navigated first): a compiled page's
 * islands are torn down with it (their stream, store and roots — `IslandDocument.dispose`).
 */
export function clearInitialStory(): void {
  if (compiled && initialStory) {
    islandDocumentOf(initialStory)?.dispose();
    removeServedChrome();
    revealAppRoot();
  }
  initialStory?.remove();
  initialStory = null;
  compiled = false;
}
/**
 * The server-rendered document story (lib/story-runtime/inline-composition)
 * waiting to be hydrated, when there is one — a starter's instructions are not
 * one. It stays in place until the inline runtime adopts it. On a compiled page
 * it is the story root itself.
 */
export function initialDocumentStory(): HTMLElement | null {
  if (compiled) return initialStory instanceof HTMLElement ? initialStory : null;
  const story = initialStory?.lastElementChild;
  return story instanceof HTMLElement && story.hasAttribute('data-mx-inline-story') ? story : null;
}
/** Whether the waiting story is a compiled page's: adopted as it is, never hydrated by React. */
export function initialStoryIsCompiled(): boolean {
  return compiled && !!initialStory;
}
/** The waiting compiled story's live island document, when its module booted (a page with no islands has none). */
export function initialIslandDocument(): IslandDocument | null {
  return compiled ? islandDocumentOf(initialStory) : null;
}
/**
 * Hand the waiting document story to the runtime that hydrates it, once: the
 * story leaves the server's wrapper, and the wrapper (with its handoff rule) is
 * removed. The caller moves the story into the app's tree in the same commit.
 *
 * A compiled story is handed over IN PLACE — still connected, so the caller's move keeps it
 * whole (`moveBefore` where the browser has it) — with its `__mxIslands` intact; the served
 * chrome goes and the app's root is revealed in the same step.
 */
export function adoptInitialStory(): HTMLElement | null {
  const story = initialDocumentStory();
  if (compiled) {
    initialStory = null;
    compiled = false;
    removeServedChrome();
    revealAppRoot();
    return story;
  }
  if (story) story.remove();
  clearInitialStory();
  return story;
}

/**
 * The text of the served story's `<style>` — the ONE copy of the document's
 * isolated sheet on an app page that inlined its story (server/app
 * withoutInlinedSheet). Read from the DOM as served, before anything adopts it.
 */
export function initialStorySheet(): string | null {
  const wrapper = servedWrapper();
  // A compiled page (lib/compiled-page/assembler) carries the version's isolated sheet once, in the head.
  if (!wrapper) {
    const sheet = compiledRoot() ? document.head.querySelector('style[data-mx-story-css]') : null;
    return sheet instanceof HTMLStyleElement ? sheet.textContent : null;
  }
  const story = wrapper.lastElementChild;
  // The composition's own `<style>` — its first STYLE child: React may emit resource hints (`<link>`) ahead of it.
  const style = story?.hasAttribute('data-mx-inline-story') ? story.querySelector(':scope > style') : null;
  return style instanceof HTMLStyleElement ? style.textContent : null;
}
