/**
 * THE STORY FRAGMENT DOOR (`GET /a/:id/story`, docs/phase2-architecture.md §2.4): a compiled page's newest
 * version, as the page that asks would be served it — the same assembler output, the same admission and
 * the same sandbox as `/raw` (app/a/[id]/raw) — for the live morph (lib/islands/morph/engine) to draw in
 * place. Browser-safe: the engine names it, the route and the markup CSP admit it.
 */
import { type ReviewJson } from '../../../contracts/src/comment-view-state';

/** The fragment's address for one document (path-exact in the `/raw` page's connect-src). */
export const storyFragmentPath = (id: string): string => `/a/${encodeURIComponent(id)}/story`;

/**
 * Which page asks: `raw` (the chrome-less reader copy, the standalone document's sheets) or `app` (the app page's
 * story: its one isolated sheet and its inline drawings). The rest of the query string is the page's own.
 */
export const STORY_SURFACE_PARAM = 'surface';
export type StorySurface = 'raw' | 'app';

/**
 * The reader's VIEW STATE the fragment is rendered at, as JSON: the commentable state of the page's kit elements (the
 * chosen tab, an open disclosure — lib/story-runtime/comment-state) by key, beside its `$` values. Only the fragment
 * reads it: a page drawn from it keeps running tree state the server would otherwise draw at its defaults.
 */
const STORY_VIEW_PARAM = 'mx-view';

/**
 * The most view state a fragment request carries, encoded: well inside a request line any server or proxy takes. A page
 * holding more asks at its defaults instead (`fragmentView`), as it did before the fragment knew view state.
 */
const STORY_VIEW_MAX_BYTES = 6144;

/** The view state a morph asks its fragment at: `view` when it fits a request, else none. */
export function fragmentView(view: Readonly<Record<string, ReviewJson>>): Readonly<Record<string, ReviewJson>> {
  return encodeURIComponent(JSON.stringify(view)).length <= STORY_VIEW_MAX_BYTES ? view : {};
}

/** The page's own query string with the surface named (the reader's `$` values and `reader=` ride along), and its view state when it has any. */
export function storyFragmentUrl(id: string, search: string, surface: StorySurface, view?: Readonly<Record<string, ReviewJson>> | null): string {
  const params = new URLSearchParams(search);
  params.set(STORY_SURFACE_PARAM, surface);
  params.delete(STORY_VIEW_PARAM);
  if (view && Object.keys(view).length) params.set(STORY_VIEW_PARAM, JSON.stringify(view));
  return `${storyFragmentPath(id)}?${params.toString()}`;
}
