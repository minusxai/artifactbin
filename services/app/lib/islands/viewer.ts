/**
 * THE VIEWER OVERLAY (docs/phase2-architecture.md §4.1, §4.2, §6; contract `ViewerOverlay`).
 *
 * A compiled page is served the same to everyone: the guest snapshot, and a non-secret hint that the
 * request carried a session. What only this reader decides — who they are, the `viewer`-scope
 * queries' answers, their write checks — arrives after paint from `GET /a/:id/viewer`
 * (`IslandPageData.viewerUrl`), which admits exactly as the query door does.
 *
 * When: the page has a viewer door and is signed-in-hinted, or its data has a viewer-scope query
 * (`hasViewerScope`). A guest page with neither never asks.
 *
 * What it changes: the answers land in the ONE store through `expectAnswer` — taken when the request
 * leaves, so a query whose inputs moved meanwhile keeps its own run, and one that did not supersedes
 * whatever the transport (the guest's door) still had in flight for it. The Solid bridge then updates
 * only the islands that read a changed table. Then `seam.setViewer` moves `viewer()` from the
 * `{ hinted: true }` placeholder to the identity (or null).
 *
 * After it, a signed-in page's re-runs (a value moved, the live stream named a dataset) are the
 * transport's: boot gives a signed-in page the session-carrying transport (lib/story-runtime/
 * fetch-transport `session`), so they answer for this reader without asking the overlay again.
 *
 * Failure (§6): the islands keep the guest snapshot and the signed-in placeholder, and the request is
 * retried a few times with backoff; a 4xx is an answer (no access any more), not a failure to retry.
 */
import type { ViewerOverlay } from '@/lib/compiled-page/contract';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';
import type { Scalar } from '@/lib/story/data/dataflow';
import { selectQueries } from '@/lib/story/data/compiled-flow';
import { writeUrlValues } from '@/lib/story/data/url-values';
import type { ServedResults } from '@/lib/story-runtime/contract';
import type { DataflowStore } from '@/lib/story-runtime/store';
import type { IslandContext, IslandPageData, IslandViewer } from './contract';

/** What boot hands the overlay: the runtime's viewer setter (an `overlay` IslandEvent follows each change). */
export interface ViewerSeam {
  setViewer(viewer: IslandViewer): void;
}

/** The overlay's outside world; tests pass their own. */
export interface ViewerOverlayEnv {
  fetch(url: string, init: RequestInit): Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
  setTimeout(fn: () => void, ms: number): unknown;
}

/** The waits before each retry of a failed overlay request; after the last, the page stays as served. */
export const VIEWER_OVERLAY_RETRY_MS: readonly number[] = [1000, 4000, 15000];

const READER_ZONE = '_tz';
const isViewerBuiltin = (name: string): boolean => name === '_me' || name.startsWith('_me.');

/**
 * Whether the page's data has a query only the reader can answer, as far as the page can tell: one
 * that reads `$_me` (transitively), or — when the server sent the guest answers — one the server
 * left out of them that the page could not have been refused for (`_tz` queries are never served).
 * The server's plan decides for real; this only decides whether to ask it.
 */
export function hasViewerScope(flow: CompiledDataflow | null, results: ServedResults | null): boolean {
  if (!flow) return false;
  return flow.queries.some((q) => {
    const closure = selectQueries(flow, { only: [q.name] });
    if (closure.some((u) => u.reads.builtins.includes(READER_ZONE))) return false;
    if (closure.some((u) => u.reads.builtins.some(isViewerBuiltin))) return true;
    return !!results && !Object.hasOwn(results.tables, q.name) && !Object.hasOwn(results.errors, q.name);
  });
}

/** The page asks for the overlay: it has the door, and the reader is signed in or the data needs them. */
export function wantsViewerOverlay(data: IslandPageData, flow: CompiledDataflow | null): boolean {
  return !!data.viewerUrl && (data.signedIn || hasViewerScope(flow, data.results));
}

/** The overlay URL at these values: the page's `$` params, as the route reads them (lib/story/data/url-values). */
export function viewerOverlayUrl(viewerUrl: string, flow: CompiledDataflow | null, values: Record<string, Scalar>): string {
  const at = viewerUrl.indexOf('?');
  const path = at < 0 ? viewerUrl : viewerUrl.slice(0, at);
  const search = at < 0 ? '' : viewerUrl.slice(at);
  return flow ? `${path}${writeUrlValues(search, flow, values)}` : viewerUrl;
}

/**
 * Whether the URL can state every value the answers depend on. A value kept out of links
 * (`url={false}`) away from its default, or a table Value the reader has written (its rows are no
 * longer the ones the page started with), cannot travel: the overlay would answer for the declared
 * state, so its rows are not landed and the page's own run stands.
 */
function carriesFor(flow: CompiledDataflow, store: DataflowStore): () => boolean {
  const tables = flow.values.filter((v) => v.kind === 'table').map((v) => v.name);
  const initial = new Map(tables.map((name) => [name, store.getTable(name)]));
  return () => {
    const values = store.getState().values;
    const moved = flow.values.some((v) => v.kind === 'scalar' && v.url === false && !Object.is(values[v.name] ?? null, v.default ?? null));
    return !moved && tables.every((name) => store.getTable(name) === initial.get(name));
  };
}

const defaultEnv = (): ViewerOverlayEnv => ({
  fetch: (url, init) => fetch(url, init),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
});

const identityOf = (overlay: ViewerOverlay): IslandViewer => (overlay.viewer && typeof overlay.viewer.id === 'string' ? overlay.viewer : null);

export function loadViewerOverlay(context: IslandContext, data: IslandPageData, seam: ViewerSeam, env: ViewerOverlayEnv = defaultEnv()): void {
  const store = context.store();
  const flow = store?.flow ?? null;
  if (!data.viewerUrl || !wantsViewerOverlay(data, flow)) return;
  const viewerUrl = data.viewerUrl;
  const carries = store && flow ? carriesFor(flow, store) : () => true;

  let attempt = 0;

  const send = () => {
    if (store?.disposed) return;
    // Taken as the request leaves: an input that moves before the answer lands keeps its own run.
    const land = store?.expectAnswer();
    const exact = carries();
    const url = viewerOverlayUrl(viewerUrl, flow, store ? store.getState().values : data.values);
    env.fetch(url, { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw Object.assign(new Error(`viewer overlay failed (${res.status})`), { status: res.status });
        return (await res.json()) as ViewerOverlay;
      })
      .then((overlay) => {
        attempt = 0;
        if (store?.disposed) return;
        const results = overlay.results ?? { tables: {}, errors: {} };
        if (land && exact) {
          land({
            tables: results.tables ?? {}, errors: results.errors ?? {},
            ...(results.mutationAccess ? { mutationAccess: results.mutationAccess } : {}),
            ...(results.userOptions ? { userOptions: results.userOptions } : {}),
            ...(results.people ? { people: results.people } : {}),
          });
        }
        // After the rows: a viewer-scope island leaves its placeholder straight for this reader's content.
        seam.setViewer(identityOf(overlay));
      })
      .catch((error: unknown) => {
        const status = (error as { status?: number }).status;
        if (status !== undefined && status >= 400 && status < 500) return;
        const wait = VIEWER_OVERLAY_RETRY_MS[attempt++];
        if (wait !== undefined) env.setTimeout(send, wait);
      });
  };

  send();
}
