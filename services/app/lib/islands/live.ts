/**
 * THE COMPILED PAGE'S LIVE STREAM (docs/phase2-architecture.md §2.4, §5.2): the island runtime's own
 * starter, opened by `boot` on a top-level page whose `<body>` names its live identity.
 *
 * It picks up where the page's SNAPSHOT left off. A guest snapshot may be minutes old when it is
 * served (stale-but-young, revalidating), so the page opens its stream with `?since=` — the
 * snapshot's marks (lib/story/served-results.server `tokenOf`) — and the stream sends the ordinary
 * `data` frame at once for every dataset whose mark has moved since. The page then re-runs exactly
 * the queries that read it: a stale snapshot refreshes when the stream connects, not on the next
 * write.
 *
 *  - `data` frame → the page's data hook (`STORY_DATA_HOOK`, which boot points at the store's
 *    `invalidateDatasets`); a page with no data hook has nothing to re-run and reloads, keeping the
 *    reader's place.
 *  - a version ping (a new `editId`) → the compiled page cannot re-render its static parts in the
 *    browser, so it reloads, keeping the reader's place; the server serves the new version compiled.
 *    Once the app has adopted the page (components/IslandStory installs `STORY_ADOPT_HOOK`) the app
 *    holds the document's stream and renders the new version itself: a reload under it would lose it.
 *
 * The same stream, door and ACL as today's (lib/story-runtime/live-entry, which the standalone
 * runtime's deletion removes); only `since` is new.
 */
import { STORY_ADOPT_HOOK, STORY_DATA_EVENT, STORY_DATA_HOOK } from '@/lib/story-runtime/contract';
import { currentAnchor } from '@/lib/story-runtime/anchor';
import { writeReloadAnchor } from '@/lib/story-runtime/reader-mode';

/** The stream's address: the document's own events door, with the snapshot's marks when the page was served from one. */
export const islandLiveUrl = (id: string, since?: string | null): string =>
  `/a/${encodeURIComponent(id)}/events${since ? `?since=${encodeURIComponent(since)}` : ''}`;

export function startIslandLive(win: Window, id: string, initialEditId: string, since?: string | null): () => void {
  const source = new EventSource(islandLiveUrl(id, since));
  let seen = initialEditId;

  const reload = () => {
    // The editor owns its save and preview updates. A page-level stream can
    // still be open when a document has no island module to hand off from.
    if (win.location.hash === '#edit') return source.close();
    const anchor = currentAnchor(win);
    if (anchor) writeReloadAnchor(win, anchor);
    win.location.reload();
  };

  source.addEventListener(STORY_DATA_EVENT, (event: MessageEvent) => {
    let frame: { datasets?: unknown };
    try { frame = JSON.parse(event.data as string) as { datasets?: unknown }; } catch { return; }
    if (!Array.isArray(frame.datasets) || frame.datasets.length === 0) return;
    const datasets = frame.datasets.filter((d): d is string => typeof d === 'string');
    const invalidate = (win as unknown as Record<string, unknown>)[STORY_DATA_HOOK] as ((datasets: string[]) => void) | undefined;
    if (invalidate) invalidate(datasets);
    else reload();
  });

  source.onmessage = (event: MessageEvent) => {
    let ping: { editId?: unknown };
    try { ping = JSON.parse(event.data as string) as { editId?: unknown }; } catch { return; }
    if (typeof ping.editId !== 'string' || !ping.editId || ping.editId === seen) return;
    seen = ping.editId;
    if (typeof (win as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK] === 'function') return;
    reload();
  };

  return () => source.close();
}
