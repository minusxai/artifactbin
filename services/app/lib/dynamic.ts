/**
 * Browser-only panes: the component mounts only in the browser — after the
 * hydration commit where there is server markup to agree with. A React.lazy alone is
 * not that — SSR would suspend on a boundary the server can never resolve, and
 * React answers that by discarding the tree and re-rendering the root (#419;
 * seen as "no page errors" failing in the full-kit gate, with the chart
 * drawing anyway because the recovery worked). Everything reached through this
 * shim is a client-only pane: the editor, the source editor, the chart chunk.
 */
'use client';
import { createElement, lazy, Suspense, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';

const NO_SUBSCRIBE = () => () => {};

export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  opts: { loading?: () => ReactNode; ssr?: boolean } = {},
): ComponentType<P> & { preload(): Promise<void> } {
  let pending: Promise<{ default: ComponentType<P> }> | undefined;
  let arrived: ComponentType<P> | undefined;
  const load = () => pending ??= loader().then(m => {
    const module = 'default' in m ? m : { default: m as ComponentType<P> };
    arrived = module.default;
    return module;
  });
  const Lazy = lazy(load);
  const fallback = () => (opts.loading ? opts.loading() : null);
  const Dynamic = (props: P) => {
    // The server renders the fallback, and a HYDRATING render draws the same;
    // the client swaps in the real component right after, so the two agree on
    // the first paint and nothing suspends where it cannot resolve. A plain
    // client render (createRoot) has no server markup to agree with, so it
    // draws the component at once.
    const client = useSyncExternalStore(NO_SUBSCRIBE, () => true, () => opts.ssr === true);
    // Code that already arrived renders on this commit — no lazy() read, so no
    // suspended frame and no fallback reveal throttle. Chosen once per mount.
    const [Arrived] = useState(() => arrived);
    if (!client) return fallback();
    return createElement(Suspense, { fallback: fallback() }, createElement(Arrived ?? Lazy, props));
  };
  Dynamic.displayName = 'Dynamic';
  return Object.assign(Dynamic, { preload: () => load().then(() => undefined) });
}

/**
 * A FEATURE a reader does not need to read — sharing, the comment layer — kept
 * out of the route's first download and fetched when it is about to be used.
 *
 * One module identity per feature, so the idle prefetch, a trigger's hover and
 * the mount that needs it all share the same download. A failed download is
 * forgotten (the next `load()` asks again): the import can fail honestly — the
 * reader went offline, or a redeploy replaced the content-addressed chunk this
 * page's build names — and a retry must be able to succeed. Once arrived it is
 * held synchronously, so a prefetched feature renders on the very commit it is
 * asked for, with no fallback frame.
 */
export interface OnDemand<M> {
  /** The module, downloading it once; rejects when the download fails. */
  load(): Promise<M>;
  /** The module if it has already arrived, synchronously. */
  loaded(): M | undefined;
  /** Warm it: a missed prefetch is not an error, the real `load()` reports. */
  prefetch(): void;
}

export function onDemand<M>(loader: () => Promise<M>): OnDemand<M> {
  let pending: Promise<M> | undefined;
  let arrived: M | undefined;
  const load = () => pending ??= loader().then(
    (module) => { arrived = module; return module; },
    (error: unknown) => { pending = undefined; throw error; },
  );
  return { load, loaded: () => arrived, prefetch: () => { void load().catch(() => {}); } };
}

/**
 * Render-side of {@link onDemand}: the module once it is there, whether the
 * download failed, and the gesture that retries it. `wanted` false defers the
 * download (a closed panel); true starts it. Nothing here runs on a server —
 * effects never fire there — so a server render draws the caller's fallback.
 */
export function useOnDemand<M>(feature: OnDemand<M>, wanted = true): { module: M | undefined; failed: boolean; retry: () => void } {
  const [, arrived] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const module = feature.loaded();
  useEffect(() => {
    if (!wanted || module) return;
    let live = true;
    feature.load().then(() => { if (live) arrived((n) => n + 1); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [feature, wanted, module, attempt]);
  return { module, failed: failed && !module, retry: () => { setFailed(false); setAttempt((n) => n + 1); } };
}

/**
 * Run `task` once the browser is idle after the page became interactive — a
 * `requestIdleCallback` bounded by `timeout`, or a plain timer where there is
 * none. Returns the cancel: a warm must never outlive the page that asked for
 * it (an uncancelled timer fires into a page that is gone).
 */
export function whenIdle(task: () => void, { timeout = 3000, fallbackDelay = 1500 }: { timeout?: number; fallbackDelay?: number } = {}): () => void {
  const w = window as unknown as {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (w.requestIdleCallback) {
    const handle = w.requestIdleCallback(task, { timeout });
    return () => w.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(task, fallbackDelay);
  return () => clearTimeout(timer);
}
