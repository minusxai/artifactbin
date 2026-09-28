/**
 * THE STORY FRAGMENT DOOR (`GET /a/:id/story`, docs/phase2-architecture.md §2.4): a compiled page's newest
 * version, as the page that asks would be served it — the same assembler output, the same admission and
 * the same sandbox as `/raw` (app/a/[id]/raw) — for the live morph (lib/islands/morph/engine) to draw in
 * place. Browser-safe: the engine names it, the route and the markup CSP admit it.
 */

/** The fragment's address for one document (path-exact in the `/raw` page's connect-src). */
export const storyFragmentPath = (id: string): string => `/a/${encodeURIComponent(id)}/story`;

/**
 * Which page asks: `raw` (the chrome-less reader copy, today's standalone sheets) or `app` (the app page's
 * story: its one isolated sheet and its inline drawings). The rest of the query string is the page's own.
 */
export const STORY_SURFACE_PARAM = 'surface';
export type StorySurface = 'raw' | 'app';

/** The page's own query string with the surface named (the reader's `$` values and `reader=` ride along). */
export function storyFragmentUrl(id: string, search: string, surface: StorySurface): string {
  const params = new URLSearchParams(search);
  params.set(STORY_SURFACE_PARAM, surface);
  return `${storyFragmentPath(id)}?${params.toString()}`;
}
