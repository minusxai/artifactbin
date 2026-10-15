/**
 * WHICH BUILD THIS PAGE IS, AND WHETHER THE SERVER HAS MOVED ON (lib/http/app-build has the carriers).
 *
 * A tab outlives deploys. Its lazy chunks are named by content hash and the server serves only the current build's,
 * so after a deploy the old page's next lazy import 404s — and Solid's `lazy` keeps that rejection, so no retry in
 * the page can ever succeed. The page recovers by LOADING THE NEW BUILD:
 *
 *  - PROACTIVELY: once anything says the server is on another build — a live stream's heartbeat (observeLiveBuild),
 *    a page-data response's header (noteServerBuild), or a chunk that failed to load in the background
 *    (Vite's `vite:preloadError`) — the page is `buildStale`, and its next navigation is a full load of the address
 *    (solid/components/BuildRecovery StaleBuildNavigation), which never asks for an old chunk.
 *  - REACTIVELY: a missing chunk that reaches the page's boundary (`isChunkLoadError`) reloads the address
 *    (`reloadForNewBuild`), ONCE per build change: the reload is remembered in the tab's session storage under the
 *    build it left, and the same build failing again shows a Reload button rather than looping.
 *
 * Before either navigation the page's unsaved work is flushed (`registerBeforeReload`, bounded); drafts that live
 * only in the page (comment and reply drafts) are kept in session storage as they are typed (solid/lib/draft-store),
 * so the reloaded page shows them again.
 */
import { createSignal } from 'solid-js';
import { APP_BUILD_META } from '@/lib/http/app-build';
import { observeLiveBuild } from '@/lib/http/live-stream';

/** The slice of `window` this needs; injectable so a test can stand in for a page load. */
export interface BuildHost {
  document: Pick<Document, 'querySelector'>;
  location: { reload(): void; assign(url: string): void; href: string };
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** The tab's memory of the last automatic reload: the build it left, and when. */
const RELOAD_KEY = 'artifactbin:build-reload';
/** With no build to tell builds apart (development), one automatic reload per this long. */
const UNKNOWN_BUILD_WINDOW_MS = 10 * 60_000;
/** How long unsaved work may hold a reload. */
const FLUSH_BOUND_MS = 2_000;

let host: BuildHost | null = typeof window === 'undefined' ? null : window;
let own: string | null = null;
const [stale, setStale] = createSignal(false);
const flushes = new Set<() => unknown>();
/**
 * The page is being left (beforeunload/pagehide): imports in flight fail as the navigation aborts them, in the same
 * words as a missing chunk, and a reload then would cancel the navigation the reader asked for. A navigation that is
 * cancelled leaves the page here: it counts as staying after LEAVING_MS, or at once on pageshow.
 */
let leaving = false;
let leavingTimer: ReturnType<typeof setTimeout> | undefined;
const LEAVING_MS = 3_000;

/** Whether the server is known to serve a newer build than this page is. */
export const buildStale = stale;

/** A response or a stream named the server's build. */
export function noteServerBuild(build: string | null | undefined): void {
  if (build && own && build !== own) setStale(true);
}

/** Unsaved work to flush before the page navigates for a new build. Returns the unregister. */
export function registerBeforeReload(flush: () => unknown): () => void {
  flushes.add(flush);
  return () => { flushes.delete(flush); };
}

/** Whether `error` is a lazy chunk (or its stylesheet) that could not be loaded, in any engine's wording. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk \S+ failed/i.test(message);
}

async function settle(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const all = Promise.all([...flushes].map(async (flush) => { try { await flush(); } catch { /* the reload goes ahead */ } }));
  await Promise.race([all, new Promise<void>((resolve) => { timer = setTimeout(resolve, FLUSH_BOUND_MS); })]);
  clearTimeout(timer);
}

/**
 * Load the new build at this address, unless this tab already did so from this build. `'exhausted'`: it did (the
 * reload came back on the same build), and only the reader's own Reload is left; no storage also means no automatic
 * reload, since nothing could stop a loop.
 */
export function reloadForNewBuild(): 'reloading' | 'exhausted' {
  const target = host;
  if (!target) return 'exhausted';
  // Leaving: the next page is on its way, and it is the new build's if there is one.
  if (leaving) return 'reloading';
  const from = own ?? 'unknown';
  try {
    const storage = target.sessionStorage;
    if (!storage) return 'exhausted';
    const last = JSON.parse(storage.getItem(RELOAD_KEY) ?? 'null') as { from?: unknown; at?: unknown } | null;
    if (last?.from === from && (own !== null || Date.now() - Number(last.at) < UNKNOWN_BUILD_WINDOW_MS)) return 'exhausted';
    storage.setItem(RELOAD_KEY, JSON.stringify({ from, at: Date.now() }));
  } catch { return 'exhausted'; }
  void settle().then(() => { if (!leaving) target.location.reload(); });
  return 'reloading';
}

/** The reader's own Reload (always allowed). */
export function reloadNow(): void {
  const target = host;
  if (target) void settle().then(() => target.location.reload());
}

/** Go to `to` as a full load (the next navigation of a stale page). */
export function navigateFresh(to: string): void {
  const target = host;
  if (target) void settle().then(() => target.location.assign(to));
}

/** Start watching: read the page's own build, and listen for every sign the server moved on. Returns the stop. */
export function watchAppBuild(target: BuildHost = window): () => void {
  host = target;
  own = target.document.querySelector(`meta[name="${APP_BUILD_META}"]`)?.getAttribute('content') || null;
  setStale(false);
  leaving = false;
  // Not prevented: the import still rejects, and the boundary that catches it decides (isChunkLoadError).
  const onPreloadError = () => { if (!leaving) setStale(true); };
  const onLeave = () => {
    leaving = true;
    clearTimeout(leavingTimer);
    leavingTimer = setTimeout(() => { leaving = false; }, LEAVING_MS);
  };
  const onStay = () => { leaving = false; clearTimeout(leavingTimer); };
  target.addEventListener('vite:preloadError', onPreloadError);
  target.addEventListener('beforeunload', onLeave);
  target.addEventListener('pagehide', onLeave);
  target.addEventListener('pageshow', onStay);
  const stopLive = observeLiveBuild(noteServerBuild);
  return () => {
    target.removeEventListener('vite:preloadError', onPreloadError);
    target.removeEventListener('beforeunload', onLeave);
    target.removeEventListener('pagehide', onLeave);
    target.removeEventListener('pageshow', onStay);
    clearTimeout(leavingTimer);
    stopLive();
  };
}
