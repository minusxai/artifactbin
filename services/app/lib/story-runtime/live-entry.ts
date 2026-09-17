/**
 * A SHARED DOCUMENT HEARS ITS OWN AUTHOR.
 *
 * Hand someone a link and let an agent write: that is the product. It did not
 * work. A reader is served the document itself, top-level (proxy.ts), and the
 * document had no way to learn that it had changed — the live stream was held
 * by the app's page, which a reader never gets. They read the version they
 * loaded, for as long as they kept the tab open.
 *
 * So the document listens for itself. Two things make that safe rather than a
 * new surface: the stream is the SAME read ACL as the page (it re-checks on
 * every wakeup, and answers a cookie-less caller for a public document exactly
 * as it answers one for a private one — with a uniform 404), and its URL is
 * named in this document's own CSP, absolute and path-exact, alongside the
 * query endpoint it already had.
 *
 * TOP-LEVEL ONLY. Inside a parent — the owner's shell, the edit canvas, a
 * capture — the page holds the stream and posts updates in (contract.ts), and
 * the frame is opaque-origin, so its own request would carry no session and a
 * private document would refuse it.
 *
 * Shipped with the reading-position module rather than the runtime, because a
 * document of pure prose loads no runtime at all and its reader deserves the
 * same thing. Where the runtime is absent there is no React to re-render with,
 * so the document reloads instead — keeping the reader's place, which is the
 * one thing a reload would otherwise cost.
 */
import { STORY_ADOPT_HOOK, STORY_DATA_EVENT, STORY_DATA_HOOK, STORY_DOCUMENT_MESSAGE, type StoryDocumentUpdate } from './contract';
import { currentAnchor } from './anchor';
import { takeReloadAnchor, writeReloadAnchor } from './reader-mode';
import type { ScrollAnchor } from '@/lib/story/scroll-anchor';

/** What the stream sends (`lib/story/live` ArtifactLiveEvent, as app/a/[id]/events sends it), as much as we use. */
interface LiveFrame {
  editId: string;
  version: number;
  format: string;
  nodes?: StoryDocumentUpdate['nodes'];
  dataflow?: StoryDocumentUpdate['dataflow'];
  declarations?: string | null;
  compiledCss?: string | null;
  authorCss?: string | null;
  theme?: string | null;
  colorMode?: 'light' | 'dark' | null;
}

/** What the stream sends on a version: the head's identity. The frame is fetched. */
interface VersionPing { editId: string; version: number }


/*
 * Where the reader was, across the reload a document with no runtime needs:
 * the shared `mx:doc:` window.name envelope (lib/story-runtime/reader-mode),
 * which survives a same-tab navigation and needs no storage permission — a
 * served document has none: it is sandboxed without `allow-same-origin` even
 * top-level, so its origin is opaque and every storage API throws. Shared with
 * the reader's mode override, which is why the write is a MERGE: a reload must
 * carry the place without dropping the mode, and vice versa.
 */

export function startDocumentLive(win: Window, id: string, initialEditId: string): () => void {
  const source = new EventSource(`/a/${id}/events`);
  let seen = initialEditId;

  /*
   * A DATASET under this document changed (a named `data` frame, app/a/[id]/events).
   *
   * Deliberately NOT the document path above: nothing about the document has
   * changed, so re-rendering it — or worse, reloading — would be the flicker
   * the whole live design exists to avoid. The runtime re-runs the queries
   * that read this dataset and the affected embeds redraw in place, keeping
   * the reader's scroll, their selections and every other chart untouched.
   *
   * A document with no runtime has nothing to re-run and no rows to update
   * live: it reloads, exactly as it does for a document change, carrying the
   * reader's place across (its rows were server-rendered, so a reload is how
   * it sees new ones at all).
   */
  source.addEventListener(STORY_DATA_EVENT, (event: MessageEvent) => {
    let frame: { datasets?: unknown };
    try { frame = JSON.parse(event.data as string) as { datasets?: unknown }; } catch { return; }
    if (!Array.isArray(frame.datasets) || frame.datasets.length === 0) return;
    const invalidate = (win as unknown as Record<string, unknown>)[STORY_DATA_HOOK] as
      | ((datasets: string[]) => void)
      | undefined;
    if (invalidate) { invalidate(frame.datasets as string[]); return; }
    const anchor = currentAnchor(win);
    if (anchor) writeReloadAnchor(win, anchor);
    win.location.reload();
  });

  // The declarations this document currently binds — a frame whose signature
  // differs carries a new flow to rebind; one whose signature matches keeps the
  // rows already on screen.
  let declarations: string | null | undefined;

  const reload = () => {
    const anchor = currentAnchor(win);
    if (anchor) writeReloadAnchor(win, anchor);
    win.location.reload();
  };

  /*
   * A VERSION PING. The stream names the head (`{editId, version, by}`) and
   * nothing else — a relay blind to content can carry it — so the document
   * fetches its own frame from `./events/frame` (complete, cached per version,
   * and the one other URL its CSP admits). A document with no runtime cannot
   * re-render itself and reloads instead, keeping the reader's place.
   */
  source.onmessage = (event: MessageEvent) => {
    let ping: VersionPing;
    try { ping = JSON.parse(event.data as string) as VersionPing; } catch { return; }
    if (!ping.editId || ping.editId === seen) return;
    seen = ping.editId;

    const adopt = (win as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK] as
      | ((update: StoryDocumentUpdate) => void)
      | undefined;
    if (!adopt) { reload(); return; }

    void win.fetch(`/a/${id}/events/frame`)
      .then((r) => (r.ok ? (r.json() as Promise<LiveFrame>) : null))
      .then((frame) => {
        if (!frame || frame.editId !== seen) return; // superseded while in flight
        if (frame.format !== 'markup' || !frame.nodes) { reload(); return; }
        const rebind = declarations !== undefined && frame.declarations !== declarations;
        declarations = frame.declarations ?? null;
        adopt({
          type: STORY_DOCUMENT_MESSAGE,
          nodes: frame.nodes,
          ...(rebind && frame.dataflow ? { dataflow: frame.dataflow } : {}),
          ...(frame.compiledCss !== undefined ? { compiledCss: frame.compiledCss } : {}),
          ...(frame.authorCss !== undefined ? { authorCss: frame.authorCss } : {}),
          theme: frame.theme ?? null,
          ...(frame.colorMode ? { colorMode: frame.colorMode } : {}),
        });
      })
      .catch(() => { /* a failed fetch is a dropped wakeup; the next ping retries */ });
  };

  return () => source.close();
}

/** The place a reload was asked to keep, if this load is that reload (mode override preserved). */
export function anchorAfterReload(win: Window): ScrollAnchor | null {
  return takeReloadAnchor(win);
}
