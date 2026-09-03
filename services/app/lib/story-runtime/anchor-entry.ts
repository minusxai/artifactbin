/**
 * WHAT EVERY SERVED DOCUMENT NEEDS, hydrating or not.
 *
 * Its own entry, ~1 KB, because a document of pure prose ships no runtime at
 * all (lib/story/document needsRuntime) and still has a reader in it. Nothing
 * here touches React.
 *
 * Two jobs, both of them the READER's — a shared link is live, and a live
 * update to a document that cannot re-render itself is a reload:
 *  - hold this document's own stream (lib/story-runtime/live-entry), which
 *    nobody else can hold for it;
 *  - put the reader back where that reload left them.
 *
 * IT RUNS `async`, AND ITS TAG SITS AT THE END OF <body> (lib/story/document).
 * Both halves are load-bearing and neither is visible from here:
 *
 *  - `async` is what frees it from the module queue. Without it this module
 *    executes only after every module script before it, so on a chart document
 *    the reader's own chrome — the phone bar's scroll relay, the outline's
 *    clicks, the scroll-marked tables — waited for the whole ~1 MB runtime to
 *    download AND evaluate while the document was already on screen. Nothing
 *    here depends on the runtime, so there is no order to keep. The one edge
 *    that buys: a version ping landing in the gap between this module and the
 *    runtime finds no adopt hook and RELOADS the document instead of
 *    re-rendering it (live-entry reads the hook per ping, not at load, so it
 *    is a slightly worse update and never a broken one).
 *  - the END OF <body> is why there is no `readyState` guard: everything this
 *    module queries — the reader chrome, its panels, the tables, the headings
 *    — is parsed before its own tag is. Moving the tag earlier, or injecting
 *    this module dynamically, needs a DOMContentLoaded wait added here first.
 */
import { STORY_MODE_HOOK, STORY_READER_MODE_MESSAGE, STORY_SCROLL_MESSAGE, type StoryReaderModeMessage, type StoryScrollMessage } from './contract';
import { applyAnchor } from './anchor';
import { holdAnchor } from './anchor-restore';
import { applyReaderMode, persistReaderMode } from './reader-mode';
import { anchorAfterReload, startDocumentLive } from './live-entry';
import { markScrollableTables } from './table-scroll';
import { wireOutline } from './outline-nav';

/*
 * READER APPEARANCE — wired here because this module is in every served
 * document, including pure prose. Top-level readers choose from the controls
 * panel; a framed owner/editor receives the same choice from its trusted
 * parent. Both paths change only local reading state and re-ink hydrated
 * charts through the runtime's private hook.
 */
if (typeof window !== 'undefined') {
  const choices = Array.from(document.querySelectorAll<HTMLElement>('[data-mx-mode-choice]'));
  const applyMode = (next: 'light' | 'dark') => {
    applyReaderMode(document, next);
    persistReaderMode(window, next);
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.mxModeChoice === next));
    const hook = (window as unknown as Record<string, unknown>)[STORY_MODE_HOOK] as
      | ((mode: 'light' | 'dark') => void)
      | undefined;
    hook?.(next);
  };
  for (const choice of choices) {
    choice.setAttribute('aria-pressed', String(choice.dataset.mxModeChoice === (document.documentElement.classList.contains('dark') ? 'dark' : 'light')));
    choice.addEventListener('click', () => {
      const next = choice.dataset.mxModeChoice;
      if (next === 'light' || next === 'dark') applyMode(next);
    });
  }
  window.addEventListener('message', (event: MessageEvent<StoryReaderModeMessage>) => {
    if (window.parent === window || event.source !== window.parent) return;
    if (event.data?.type !== STORY_READER_MODE_MESSAGE || (event.data.mode !== 'light' && event.data.mode !== 'dark')) return;
    applyMode(event.data.mode);
  });

  // The two page-mounted controls share one scrim and one open panel. Keeping
  // this behaviour in the every-document entry gives pure prose the same
  // Escape and click-away contract as a hydrated artifact.
  const triggers = Array.from(document.querySelectorAll<HTMLElement>('[data-mx-reader-trigger]'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-mx-reader-panel]'));
  const scrim = document.querySelector<HTMLElement>('[data-mx-reader-scrim]');
  const chrome = document.querySelector<HTMLElement>('[data-mx-reader-chrome]');
  const closePanels = () => {
    for (const trigger of triggers) {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', trigger.dataset.mxReaderTrigger === 'menu' ? 'Open menu' : 'Open artifact controls');
    }
    for (const panel of panels) panel.hidden = true;
    if (scrim) scrim.hidden = true;
  };
  for (const trigger of triggers) {
    trigger.addEventListener('click', () => {
      chrome?.classList.remove('mx-reader-chrome--hidden');
      const name = trigger.dataset.mxReaderTrigger;
      const opening = trigger.getAttribute('aria-expanded') !== 'true';
      closePanels();
      if (!opening) return;
      const panel = panels.find((candidate) => candidate.dataset.mxReaderPanel === name);
      if (!panel) return;
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('aria-label', name === 'menu' ? 'Close menu' : 'Close artifact controls');
      panel.hidden = false;
      if (scrim) scrim.hidden = false;
    });
  }
  scrim?.addEventListener('click', closePanels);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanels(); });

  /* A phone's dock follows the reading direction. In a framed artifact the
   * visible dock belongs to the trusted parent, so send it the same scroll
   * sample; top-level documents apply the class to their own server-rendered
   * chrome. One animation-frame sample is enough however noisy touch-scroll
   * events become. */
  let lastScrollY = Math.max(0, window.scrollY);
  let scrollQueued = false;
  const framed = window.parent !== window;
  const parentWindow = window.parent;
  /* The parent cannot measure an opaque frame, so the sample carries the
   * answer: 4px of slack for subpixel rounding and the mobile URL bar, which
   * changes `innerHeight` under us as it collapses. */
  const atBottom = () =>
    window.innerHeight + Math.max(0, window.scrollY) >= document.documentElement.scrollHeight - 4;
  const updateChrome = () => {
    scrollQueued = false;
    const scrollY = Math.max(0, window.scrollY);
    if (framed) {
      parentWindow.postMessage({ type: STORY_SCROLL_MESSAGE, scrollY, atBottom: atBottom() } satisfies StoryScrollMessage, '*');
    } else if (chrome && window.innerWidth < 640 && !triggers.some((trigger) => trigger.getAttribute('aria-expanded') === 'true')) {
      const delta = scrollY - lastScrollY;
      if (scrollY <= 24 || delta <= -4) chrome.classList.remove('mx-reader-chrome--hidden');
      else if (delta >= 4 && scrollY > 72) chrome.classList.add('mx-reader-chrome--hidden');
    }
    if (Math.abs(scrollY - lastScrollY) >= 4 || scrollY <= 24) lastScrollY = scrollY;
  };
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(updateChrome);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  if (framed) updateChrome();
}

/*
 * TABLES THAT SCROLL SAY SO — in every document, framed or not (lib/story-
 * runtime/table-scroll): a wide table is its own scroll box, and this marks
 * the ones that actually overflow so the sheet can fade their edge.
 */
if (typeof window !== 'undefined') markScrollableTables(document);

/*
 * THE OUTLINE'S BEHAVIOUR — here, not in the runtime, because the documents
 * with sections are mostly prose and prose ships no runtime
 * (lib/story-runtime/outline-nav).
 */
if (typeof window !== 'undefined') wireOutline(document);

/*
 * TOP-LEVEL: this document is what the reader is looking at, so it holds its
 * own live stream — nobody else can hold one for it (lib/story-runtime/
 * live-entry) — and it puts the reader back where a reload left them.
 */
if (typeof window !== 'undefined' && window.parent === window) {
  const id = document.body.getAttribute('data-mx-live-id');
  const editId = document.body.getAttribute('data-mx-live-edit');
  if (id && editId) startDocumentLive(window, id, editId);

  const kept = anchorAfterReload(window);
  // Held against a settling layout — fonts, images and embeds each move
  // everything below them — and released the moment the reader takes over
  // (lib/story-runtime/anchor-restore). Without that release the document
  // spends four seconds undoing the reader's own scrolling.
  if (kept) holdAnchor(window, kept, applyAnchor);
}

/* FRAMED, this module has nothing left to do — editing happens in this
 * document, which never moves, so there is no reading position to carry. */
