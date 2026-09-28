/**
 * THE COMPILED /raw PAGE'S OWN BEHAVIOUR (`@mx/page`, docs/phase2-architecture.md §2.2, §9): what
 * today's standalone document did with two inline preludes and its reading-position module, as one
 * tiny framework-free chunk from the shared island build — the compiled page runs no inline script.
 * Loaded by every compiled `/raw` reader copy (never a capture), with islands or without.
 *
 *  1. `mx-framed` on `<html>` when a parent frames the document (today's MODE_PRELUDE).
 *  2. The reader's per-visit colour override from the `mx:doc:` window.name envelope
 *     (lib/story-runtime/reader-mode), on `<html>` and the story root — an opaque origin has no
 *     storage, so this is the only thing that survives a same-tab reload.
 *  3. Top-level, on a page with NO island module (prose, a deck without islands): the document's
 *     own live stream (./live). A page with islands has `boot` hold it, seeded from its snapshot.
 *  4. Top-level: puts the reader back where a live reload left them, held against a settling layout
 *     and released the moment they take over (lib/story-runtime/anchor-restore).
 *  5. On the app page (`/a/:id`, which loads this too): the SERVED reader chrome follows today's rule
 *     (lib/story-runtime/reader-chrome-policy) — shown on load, hidden by a scroll down, revealed by a
 *     scroll up and at the end — until the app's own chrome replaces it.
 *
 * A module script runs after the document is parsed, so every element it touches exists; it runs
 * before `boot` (the assembler writes behaviour scripts ahead of the per-document module).
 */
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { applyAnchor } from '@/lib/story-runtime/anchor';
import { holdAnchor } from '@/lib/story-runtime/anchor-restore';
import { readerMode, takeReloadAnchor } from '@/lib/story-runtime/reader-mode';
import { chromeAfterSample, type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { wireOutline } from '@/lib/story-runtime/outline-nav';
import { markScrollableTables } from '@/lib/story-runtime/table-scroll';
import { STORY_SCROLL_MESSAGE, type StoryScrollMessage } from '@/lib/story-runtime/contract';
import { startIslandLive } from './live';
import { PAGE_TAKEOVER_EVENT } from './page-lifetime';

const STORY_ROOT_SELECTOR = '[data-mx-inline-story]';
/**
 * lib/story/reader-chrome READER_CHROME_HIDDEN_CLASS, restated: that module is the chrome's server
 * renderer and has no place in a reader chunk (page.test pins the two equal).
 */
export const CHROME_HIDDEN_CLASS = 'mx-reader-chrome--hidden';

/** Report a framed reader's scroll to the shell, which cannot inspect an opaque frame. */
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
  if (mode) {
    for (const el of [html, doc.querySelector<HTMLElement>(STORY_ROOT_SELECTOR)]) {
      el?.classList.toggle('dark', mode === 'dark');
      el?.classList.toggle('light', mode !== 'dark');
    }
  }
  const stops: Array<() => void> = [];
  // These document affordances also run inside a frame, like the legacy page entry.
  stops.push(markScrollableTables(doc), wireOutline(doc));
  if (framed) {
    stops.push(relayFrameScroll(win, doc));
    return () => { for (const stop of stops.splice(0)) stop(); };
  }
  const id = doc.body?.getAttribute('data-mx-live-id');
  const editId = doc.body?.getAttribute('data-mx-live-edit');
  const hasModule = !!doc.getElementById(ISLAND_DATA_ID);
  if (id && editId && !hasModule && typeof (win as { EventSource?: unknown }).EventSource === 'function') stops.push(startIslandLive(win, id, editId));

  const chrome = doc.querySelector<HTMLElement>('body > [data-mx-reader-chrome]');
  if (chrome) stops.push(followChrome(win, doc, chrome));

  const kept = takeReloadAnchor(win);
  if (kept) stops.push(holdAnchor(win, kept, applyAnchor));
  const stop = () => {
    win.removeEventListener(PAGE_TAKEOVER_EVENT, stop);
    for (const release of stops.splice(0)) release();
  };
  win.addEventListener(PAGE_TAKEOVER_EVENT, stop, { once: true });
  return stop;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startPage();
