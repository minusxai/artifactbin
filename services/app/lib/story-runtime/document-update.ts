/**
 * Adopting a new version of the document, inside the served document itself.
 *
 * The tree is React's problem (entry.tsx re-renders it) and the data is the
 * store's (`replaceFlow`). What is left is everything that lives OUTSIDE the
 * React root — the document's stylesheets and its design attributes — plus the
 * decision about whether a message is one of ours at all.
 *
 * Kept apart from entry.tsx because entry.tsx runs on import: this is the part
 * that can be tested.
 */
import { STORY_DOCUMENT_MESSAGE, type StoryDocumentUpdate } from './contract';

/**
 * Is this message a document update? The frame accepts these only from its
 * parent (entry.tsx checks the source); this checks the SHAPE, because a page
 * embedding us is not the only thing that can post into a window.
 */
export function isStoryDocumentUpdate(data: unknown): data is StoryDocumentUpdate {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<StoryDocumentUpdate>;
  return d.type === STORY_DOCUMENT_MESSAGE && Array.isArray(d.nodes);
}

/**
 * Everything about the new version that is not the tree: the two stylesheets
 * this document may carry, and the design attributes the theme is selected by.
 *
 * Absent means unchanged and null means "there is none" — the stream's own
 * convention, because the stylesheet is ~65KB and rides only the frame that
 * changed it.
 *
 * `readerMode` is the reader's own override (lib/story-runtime/reader-mode):
 * while one is active the frame's `colorMode` — the AUTHOR's default — must
 * not stomp it, so the mode class is left alone and everything else still
 * applies.
 */
export function applyDocumentChrome(doc: Document, update: StoryDocumentUpdate, readerMode: 'light' | 'dark' | null = null): void {
  if (update.compiledCss !== undefined) setStyle(doc, 'data-mx-tw', update.compiledCss);
  if (update.authorCss !== undefined) setStyle(doc, 'data-mx-author', update.authorCss);

  const root = doc.documentElement;
  if (update.theme !== undefined) {
    if (update.theme) root.setAttribute('data-theme', update.theme);
    else root.removeAttribute('data-theme');
  }
  if (update.colorMode !== undefined && readerMode === null) {
    root.classList.toggle('dark', update.colorMode === 'dark');
    root.classList.toggle('light', update.colorMode !== 'dark');
  }
}

/**
 * One tagged <style> in the head. Created when it did not exist (a document
 * that gains its first utility class mid-read), removed when it goes away, and
 * otherwise a textContent swap — never a new node, so the browser re-styles
 * without re-parsing anything else.
 *
 * A new node is appended at the END of the head, which is where the document
 * builder puts these too, so ties resolve the same way they would on a reload.
 */
function setStyle(doc: Document, attr: string, css: string | null): void {
  const existing = doc.head.querySelector<HTMLStyleElement>(`style[${attr}]`);
  if (css === null) { existing?.remove(); return; }
  if (existing) { if (existing.textContent !== css) existing.textContent = css; return; }
  const el = doc.createElement('style');
  el.setAttribute(attr, '');
  el.textContent = css;
  doc.head.appendChild(el);
}
