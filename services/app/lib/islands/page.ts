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
 *  4. Framed: relays scroll samples and accepts the parent's colour choice; every copy wires its
 *     own chrome, scrollable tables and outline.
 *  5. Top-level: puts the reader back where a live reload left them, held against a settling layout
 *     and released the moment they take over (lib/story-runtime/anchor-restore).
 *
 * A module script runs after the document is parsed, so every element it touches exists; it runs
 * before `boot` (the assembler writes behaviour scripts ahead of the per-document module).
 */
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { applyAnchor } from '@/lib/story-runtime/anchor';
import { holdAnchor } from '@/lib/story-runtime/anchor-restore';
import { readerMode, takeReloadAnchor } from '@/lib/story-runtime/reader-mode';
import { STORY_READER_MODE_MESSAGE, STORY_SCROLL_MESSAGE, type StoryReaderModeMessage, type StoryScrollMessage } from '@/lib/story-runtime/contract';
import { applyReaderChoice, wireReaderChrome } from '@/lib/story-runtime/reader-chrome-actions';
import { markScrollableTables } from '@/lib/story-runtime/table-scroll';
import { wireOutline } from '@/lib/story-runtime/outline-nav';
import { startIslandLive } from './live';

const STORY_ROOT_SELECTOR = '[data-mx-inline-story]';

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
  wireReaderChrome(win, doc);
  markScrollableTables(doc);
  wireOutline(doc);
  if (framed) {
    const parent = win.parent;
    const atBottom = () => win.innerHeight + Math.max(0, win.scrollY) >= doc.documentElement.scrollHeight - 4;
    let queued = false;
    const post = () => {
      queued = false;
      parent.postMessage({
        type: STORY_SCROLL_MESSAGE,
        scrollY: Math.max(0, win.scrollY),
        atBottom: atBottom(),
        gutter: Math.max(0, win.innerWidth - doc.documentElement.clientWidth),
      } satisfies StoryScrollMessage, '*');
    };
    const scroll = () => {
      if (queued) return;
      queued = true;
      win.requestAnimationFrame(post);
    };
    const message = (event: MessageEvent<StoryReaderModeMessage>) => {
      if (event.source !== parent || event.data?.type !== STORY_READER_MODE_MESSAGE) return;
      if (event.data.mode === 'light' || event.data.mode === 'dark') applyReaderChoice(win, doc, event.data.mode);
    };
    win.addEventListener('scroll', scroll, { passive: true });
    win.addEventListener('message', message);
    post();
    return () => { win.removeEventListener('scroll', scroll); win.removeEventListener('message', message); };
  }

  const stops: Array<() => void> = [];
  const id = doc.body?.getAttribute('data-mx-live-id');
  const editId = doc.body?.getAttribute('data-mx-live-edit');
  const hasModule = !!doc.getElementById(ISLAND_DATA_ID);
  if (id && editId && !hasModule && typeof (win as { EventSource?: unknown }).EventSource === 'function') stops.push(startIslandLive(win, id, editId));

  const kept = takeReloadAnchor(win);
  if (kept) stops.push(holdAnchor(win, kept, applyAnchor));
  return () => { for (const stop of stops.splice(0)) stop(); };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startPage();
