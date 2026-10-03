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
 *  4b. Framed: the bridge's door (lib/story-runtime/frame-bridge/door), opened here because this runs before the
 *     author's script — the editor's document half (`@mx/frame-editor`) loads only when the page attaches through it.
 *  5. On the app page (`/a/:id`, which loads this too): the SERVED reader chrome follows the reader-chrome policy
 *     (lib/story-runtime/reader-chrome-policy) — shown on load, hidden by a scroll down, revealed by a
 *     scroll up and at the end — until the app's own chrome replaces it.
 *
 * A module script runs after the document is parsed, so every element it touches exists; it runs
 * before `boot` (the assembler writes behaviour scripts ahead of the per-document module).
 */
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { applyAnchor } from '@/lib/story-runtime/anchor';
import { holdAnchor } from '@/lib/story-runtime/anchor-restore';
import { applyColorMode, persistReaderMode, readerMode, takeReloadAnchor } from '@/lib/story-runtime/reader-mode';
import { chromeAfterSample, type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { wireOutline } from '@/lib/story-runtime/outline-nav';
import { markScrollableTables } from '@/lib/story-runtime/table-scroll';
import { STORY_FRAME_HASH_MESSAGE, STORY_READER_MODE_MESSAGE, STORY_SCROLL_MESSAGE, type StoryScrollMessage } from '@/lib/story-runtime/contract';
import { frameAppOrigin, openFrameDoor } from '@/lib/story-runtime/frame-bridge/door';
import { startIslandLive } from './live';
import { LIVE_DIRECT_ATTR, LIVE_EDIT_ATTR, LIVE_ID_ATTR, STORY_ROOT_SELECTOR } from './contract';
import { PAGE_TAKEOVER_EVENT } from './page-lifetime';

/**
 * lib/story/reader/reader-chrome READER_CHROME_HIDDEN_CLASS, restated: that module is the chrome's server
 * renderer and has no place in a reader chunk (page.test pins the two equal).
 */
export const CHROME_HIDDEN_CLASS = 'mx-reader-chrome--hidden';

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

/** The served chrome's visibility, sampled once per frame, until the element leaves the page (the app took over). */
function followChrome(win: Window, doc: Document, chrome: HTMLElement): () => void {
  let state: ChromeState | null = null;
  let queued = false;
  const stop = () => { win.removeEventListener('scroll', schedule); win.removeEventListener('resize', schedule); };
  const sample = () => {
    queued = false;
    if (!chrome.isConnected) { stop(); return; }
    state = chromeAfterSample(state, { scrollY: Math.max(0, win.scrollY), viewportHeight: win.innerHeight, documentHeight: doc.documentElement.scrollHeight });
    chrome.classList.toggle(CHROME_HIDDEN_CLASS, !state.visible);
    chrome.setAttribute('data-mx-reader-state', state.visible ? 'shown' : 'hidden');
  };
  function schedule() { if (!queued) { queued = true; win.requestAnimationFrame(sample); } }
  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('resize', schedule);
  sample();
  return stop;
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
  // Document affordances with no Solid-side replacement: they must outlive the SPA's takeover,
  // never cleared by `takeover()` below (only by this function's own disposer, for tests/unmount).
  const persistent: Array<() => void> = [];
  const stops: Array<() => void> = [];
  // These document affordances also run inside a frame, like the legacy page entry. Nothing on the
  // app side re-wires them, so they must survive the SPA's takeover (persistent, not stops).
  persistent.push(markScrollableTables(doc), wireOutline(doc));
  // A document on its OWN origin (APP__PAGES_HOST) is the app page's viewport: it holds its own stream and
  // reading place framed, as a top-level page does. Any other framed copy reports its scroll to the shell.
  const direct = !!doc.body?.hasAttribute(LIVE_DIRECT_ATTR);
  // The editor's document half, on its own lazy file (scripts/build/build-islands FRAME_EDITOR): never in a reader's
  // closure. Opened before the author's script runs; the app page attaches whenever it is ready (frame-bridge/parent).
  if (framed) persistent.push(openFrameDoor(win, frameAppOrigin(doc, win), () => import('./frame-editor')));
  if (framed && !direct) {
    stops.push(relayFrameScroll(win, doc));
    return () => { for (const stop of stops.splice(0)) stop(); for (const stop of persistent.splice(0)) stop(); };
  }
  if (framed) persistent.push(followFramer(win, doc));
  const id = doc.body?.getAttribute(LIVE_ID_ATTR);
  const editId = doc.body?.getAttribute(LIVE_EDIT_ATTR);
  const hasModule = !!doc.getElementById(ISLAND_DATA_ID);
  if (id && editId && !hasModule && typeof (win as { EventSource?: unknown }).EventSource === 'function') stops.push(startIslandLive(win, id, editId));

  const chrome = doc.querySelector<HTMLElement>('body > [data-mx-reader-chrome]');
  if (chrome) stops.push(followChrome(win, doc, chrome));

  const kept = takeReloadAnchor(win);
  // The SPA takes over the stream and chrome before its layout has settled.
  // Keep the reading anchor until its own timer or a reader gesture releases it.
  const stopAnchor = kept ? holdAnchor(win, kept, applyAnchor) : null;
  const takeover = () => {
    win.removeEventListener(PAGE_TAKEOVER_EVENT, takeover);
    for (const release of stops.splice(0)) release();
  };
  win.addEventListener(PAGE_TAKEOVER_EVENT, takeover, { once: true });
  return () => { takeover(); stopAnchor?.(); for (const stop of persistent.splice(0)) stop(); };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startPage();
