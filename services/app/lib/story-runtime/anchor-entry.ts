/**
 * WHAT EVERY SERVED DOCUMENT NEEDS, hydrating or not.
 *
 * Its own entry, ~1 KB, because a document of pure prose ships no runtime at
 * all (lib/story/document needsRuntime) and still has a reader in it. Nothing
 * here touches React.
 *
 * Three jobs, all of them the READER's — a shared link is live, and a live
 * update to a document that cannot re-render itself is a reload:
 *  - wire the reader's own chrome (lib/story-runtime/reader-chrome-actions),
 *    or, framed, relay the scroll the parent's chrome runs on;
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
import { STORY_READER_MODE_MESSAGE, STORY_SCROLL_MESSAGE, type StoryReaderModeMessage, type StoryScrollMessage } from './contract';
import { applyAnchor } from './anchor';
import { holdAnchor } from './anchor-restore';
import { applyReaderChoice, wireReaderChrome } from './reader-chrome-actions';
import { anchorAfterReload, startDocumentLive } from './live-entry';
import { markScrollableTables } from './table-scroll';
import { wireOutline } from './outline-nav';

/*
 * THE READER'S CHROME. Top-level, this document IS what the reader is looking
 * at, so it owns its own chrome: the reveal-on-scroll-up rule, the rail, the
 * panels and the appearance choice all live in one module
 * (lib/story-runtime/reader-chrome-actions), wired once from here because this
 * entry is what every served document loads, prose or not.
 *
 * FRAMED, none of that applies — the visible chrome belongs to the trusted
 * parent, which hides this document's own by CSS. What the frame owes the
 * parent instead is the two things the parent cannot measure or decide for
 * itself: where the reader has scrolled to (the page cannot read an opaque
 * frame's offsets, so the sample carries the end-of-document answer, not the
 * ingredients) and, in the other direction, the appearance the parent chose.
 */
if (typeof window !== 'undefined') {
  const framed = window.parent !== window;
  if (!framed) {
    wireReaderChrome(window, document);
  } else {
    const parentWindow = window.parent;
    /* 4px of slack for subpixel rounding and the mobile URL bar, which changes
     * `innerHeight` under us as it collapses. */
    const atBottom = () =>
      window.innerHeight + Math.max(0, window.scrollY) >= document.documentElement.scrollHeight - 4;
    let queued = false;
    const post = () => {
      queued = false;
      parentWindow.postMessage(
        { type: STORY_SCROLL_MESSAGE, scrollY: Math.max(0, window.scrollY), atBottom: atBottom() } satisfies StoryScrollMessage,
        '*',
      );
    };
    // One animation-frame sample is enough however noisy touch-scroll gets.
    window.addEventListener('scroll', () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(post);
    }, { passive: true });
    post();

    window.addEventListener('message', (event: MessageEvent<StoryReaderModeMessage>) => {
      if (event.source !== parentWindow) return;
      if (event.data?.type !== STORY_READER_MODE_MESSAGE || (event.data.mode !== 'light' && event.data.mode !== 'dark')) return;
      applyReaderChoice(window, document, event.data.mode);
    });
  }
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
