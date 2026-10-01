/**
 * THE COMPILED PAGE'S LIVE STREAM (docs/phase2-architecture.md §2.4, §5.2): the island runtime's own
 * starter, opened by `boot` on a top-level page whose `<body>` names its live identity.
 *
 * It picks up where the page's SNAPSHOT left off. A guest snapshot may be minutes old when it is
 * served (stale-but-young, revalidating), so the page opens its stream with `?since=` — the
 * snapshot's marks (lib/story/prepared/served-results.server `tokenOf`) — and the stream sends the ordinary
 * `data` frame at once for every dataset whose mark has moved since. The page then re-runs exactly
 * the queries that read it: a stale snapshot refreshes when the stream connects, not on the next
 * write.
 *
 *  - `data` frame → the page's data hook (`STORY_DATA_HOOK`, which boot points at the store's
 *    `invalidateDatasets`); a page with no data hook has nothing to re-run and reloads, keeping the
 *    reader's place.
 *  - a version ping (a new `editId`) → the new version drawn IN PLACE by the one update path
 *    (./live-update: the story fragment fetched and morphed, islands kept or re-hydrated, the store
 *    surviving), falling back to a reload that keeps the reader's place. Once the app has adopted the
 *    page (solid/document/create-island-story installs `STORY_ADOPT_HOOK`) the app holds the
 *    document's stream and calls the same path itself; this stream still carries the `data` frames
 *    to the island store (closing it on adoption left an in-place editing reader's tables stale).
 *
 * The stream reconnects on its own (lib/live-stream): any error or close reopens it with backoff,
 * heartbeat silence counts as dead, and a page coming back visible or online reopens a stale one.
 *
 * ONE stream per page: `page` opens it on a page with no island module, `boot` on a page with one; a
 * page whose islands arrive with a later version (prose, then a chart) keeps the stream it has — the
 * data hook `boot` installs is read per frame.
 *
 * The same stream, door and ACL as today's (lib/story-runtime/live-entry, which the standalone
 * runtime's deletion removes); only `since` is new.
 */
import { STORY_ADOPT_HOOK, STORY_DATA_EVENT, STORY_DATA_HOOK } from '@/lib/story-runtime/contract';
import { openLiveStream } from '@/lib/http/live-stream';
import { reloadKeepingPlace, updateCompiledStory } from './live-update';

/** The page's open stream, on the window: a second starter reuses it. */
const LIVE_KEY = '__mxLiveStream';

/** The stream's address: the document's own events door, with the snapshot's marks when the page was served from one. */
export const islandLiveUrl = (id: string, since?: string | null): string =>
  `/a/${encodeURIComponent(id)}/events${since ? `?since=${encodeURIComponent(since)}` : ''}`;

export function startIslandLive(win: Window, id: string, initialEditId: string, since?: string | null): () => void {
  const hooks = win as unknown as Record<string, unknown>;
  if (hooks[LIVE_KEY]) return () => {};
  let seen = initialEditId;

  const reload = () => {
    if (win.location.hash === '#edit') return;
    reloadKeepingPlace(win);
  };

  const stream = openLiveStream({
    url: islandLiveUrl(id, since),
    host: win,
    events: {
      [STORY_DATA_EVENT]: (data) => {
        let frame: { datasets?: unknown };
        try { frame = JSON.parse(data) as { datasets?: unknown }; } catch { return; }
        if (!Array.isArray(frame.datasets) || frame.datasets.length === 0) return;
        const datasets = frame.datasets.filter((d): d is string => typeof d === 'string');
        const invalidate = hooks[STORY_DATA_HOOK] as ((datasets: string[]) => void) | undefined;
        if (invalidate) invalidate(datasets);
        else reload();
      },
    },
    onMessage: (data) => {
      let ping: { editId?: unknown };
      try { ping = JSON.parse(data) as { editId?: unknown }; } catch { return; }
      if (typeof ping.editId !== 'string' || !ping.editId || ping.editId === seen) return;
      seen = ping.editId;
      if (typeof hooks[STORY_ADOPT_HOOK] === 'function') return;
      if (win.location.hash === '#edit') return;
      void updateCompiledStory(win);
    },
  });
  const handle = { close: () => stop() };
  hooks[LIVE_KEY] = handle;
  function stop() {
    stream.close();
    if (hooks[LIVE_KEY] === handle) delete hooks[LIVE_KEY];
  }
  return stop;
}
