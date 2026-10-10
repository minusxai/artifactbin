/**
 * THE STANDALONE DOCUMENT'S OWN BEHAVIOUR (`@mx/page`, docs/phase2-architecture.md §2.2, §9): what
 * the standalone document used to do with two inline preludes and its reading-position module, as one
 * tiny framework-free chunk from the shared island build — the compiled page runs no inline script.
 * Loaded by every compiled standalone reader copy (never a capture), with islands or without.
 *
 *  1. `mx-framed` on `<html>` when the app page frames the document (the former MODE_PRELUDE).
 *  2. The reader's per-visit colour override from the `mx:doc:` window.name envelope
 *     (lib/story-runtime/reader-mode), on `<html>` and the story root — the document runs on its own
 *     origin and shares no storage with the app, so this is the only thing that survives a same-tab reload.
 *  3. Top-level, on a page with NO island module (prose, a deck without islands): the document's
 *     own live stream (./live). A page with islands has `boot` hold it, seeded from its snapshot.
 *  4. Top-level: puts the reader back where a live reload left them, held against a settling layout
 *     and released the moment they take over (lib/story-runtime/anchor-restore).
 *  4b. Framed: the bridge's door (lib/islands/frame-door), opened here because this runs before the
 *     author's script — the editor's document half (`@mx/frame-editor`) loads only when the page attaches through it.
 *  4c. Framed: a link to an app path takes the app page, not the frame (lib/islands/frame-links).
 *
 * A module script runs after the document is parsed, so every element it touches exists; it runs
 * before `boot` (the assembler writes behaviour scripts ahead of the per-document module).
 */
import { applyAnchor } from '@/lib/story-runtime/anchor';
import { holdAnchor } from '@/lib/story-runtime/anchor-restore';
import { applyColorMode, persistReaderMode, readerMode, takeReloadAnchor } from '@/lib/story-runtime/reader-mode';
import { wireOutline } from './outline-nav';
import { markScrollableTables } from './table-scroll';
import { STORY_FRAME_HASH_MESSAGE, STORY_READER_MODE_MESSAGE, STORY_SCROLL_MESSAGE, type StoryScrollMessage, ISLAND_DATA_ID } from '@/lib/story-runtime/contract';
import { frameAppOrigin, openFrameDoor } from './frame-door';
import { followAppLinks } from './frame-links';
import { refuseFileNavigation } from './frame-file-drops';
import { startIslandLive } from './live';
import { LIVE_DIRECT_ATTR, LIVE_EDIT_ATTR, LIVE_ID_ATTR, STORY_ROOT_SELECTOR } from './contract';

/** Report a framed reader's scroll to the app page, which cannot inspect a frame on another origin. */
function relayFrameScroll(win: Window, doc: Document): () => void {
  if (typeof win.parent.postMessage !== 'function') return () => {};
  let queued = false;
  const post = () => {
    queued = false;
    const scrollY = Math.max(0, win.scrollY);
    win.parent.postMessage({
      type: STORY_SCROLL_MESSAGE, scrollY,
      atBottom: win.innerHeight + scrollY >= doc.documentElement.scrollHeight - 4,
      gutter: Math.max(0, win.innerWidth - doc.documentElement.clientWidth),
    } satisfies StoryScrollMessage, '*');
  };
  const schedule = () => { if (!queued) { queued = true; win.requestAnimationFrame(post); } };
  win.addEventListener('scroll', schedule, { passive: true });
  post();
  return () => win.removeEventListener('scroll', schedule);
}

/**
 * A document framed on its OWN origin takes two things from the app page that frames it — and only from
 * its parent, which `frame-ancestors` makes the app: the reader's colour choice (kept in `window.name`, so a
 * live reload keeps it) and the address's `#hash`, so a link to a heading scrolls the frame.
 */
function followFramer(win: Window, doc: Document): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent) return;
    const data = event.data as { type?: unknown; mode?: unknown; hash?: unknown } | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === STORY_READER_MODE_MESSAGE && (data.mode === 'light' || data.mode === 'dark')) {
      persistReaderMode(win, data.mode);
      doc.documentElement.setAttribute('data-mx-reader-mode', data.mode);
      for (const el of [doc.documentElement, doc.querySelector<HTMLElement>(STORY_ROOT_SELECTOR)]) applyColorMode(el, data.mode);
    } else if (data.type === STORY_FRAME_HASH_MESSAGE && typeof data.hash === 'string' && /^#\S{1,512}$/.test(data.hash)) {
      if (win.location.hash === data.hash) {
        let target: Element | null = null;
        try { target = doc.getElementById(decodeURIComponent(data.hash.slice(1))); } catch { /* malformed escape */ }
        target?.scrollIntoView();
      } else win.location.hash = data.hash;
    }
  };
  win.addEventListener('message', onMessage);
  return () => win.removeEventListener('message', onMessage);
}

export function startPage(doc: Document = document, win: Window = window): () => void {
  const html = doc.documentElement;
  const framed = win.parent !== win;
  if (framed) html.classList.add('mx-framed');

  const mode = readerMode(win);
  // The page runs before the document module: islands can read this mode without loading
  // the window.name envelope parser into every kit-family bundle.
  if (mode) html.setAttribute('data-mx-reader-mode', mode);
  else html.removeAttribute('data-mx-reader-mode');
  for (const el of [html, doc.querySelector<HTMLElement>(STORY_ROOT_SELECTOR)]) applyColorMode(el, mode);
  const stops: Array<() => void> = [];
  // The document's own affordances, framed or not.
  stops.push(markScrollableTables(doc), wireOutline(doc));
  // A document on its OWN origin (APP__PAGES_HOST) is the app page's viewport: it holds its own stream and
  // reading place framed, as a top-level page does. Any other framed copy reports its scroll to the shell.
  const direct = !!doc.body?.hasAttribute(LIVE_DIRECT_ATTR);
  // The editor's document half, on its own lazy file (scripts/build/build-islands FRAME_EDITOR): never in a reader's
  // closure. Opened before the author's script runs; the app page attaches whenever it is ready (frame-bridge/parent).
  if (framed) stops.push(openFrameDoor(win, frameAppOrigin(doc, win), () => import('./frame-editor')));
  // A link to an app path takes the app page, never the frame on the document's origin (lib/islands/frame-links).
  if (framed) stops.push(followAppLinks(win, frameAppOrigin(doc, win)));
  // A file dropped on the document never navigates the frame away from it (lib/islands/frame-file-drops).
  if (framed) stops.push(refuseFileNavigation(win));
  if (framed && !direct) {
    stops.push(relayFrameScroll(win, doc));
    return () => { for (const stop of stops.splice(0)) stop(); };
  }
  if (framed) stops.push(followFramer(win, doc));
  const id = doc.body?.getAttribute(LIVE_ID_ATTR);
  const editId = doc.body?.getAttribute(LIVE_EDIT_ATTR);
  const hasModule = !!doc.getElementById(ISLAND_DATA_ID);
  if (id && editId && !hasModule && typeof (win as { EventSource?: unknown }).EventSource === 'function') stops.push(startIslandLive(win, id, editId));

  const kept = takeReloadAnchor(win);
  // Keep the reading anchor through a live reload until its own timer or a reader gesture releases it.
  const stopAnchor = kept ? holdAnchor(win, kept, applyAnchor) : null;
  return () => { stopAnchor?.(); for (const stop of stops.splice(0)) stop(); };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startPage();
