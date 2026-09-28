/**
 * THE WRITE STATUS INDICATOR SEAM (`data-mx-write-status`, contract WRITE_STATUS_ATTR): `boot.ts`
 * calls `installStatus` once with the document's feed (lib/islands/writes) and story root and keeps
 * the disposer. The view (kit/status-view.tsx: saving, saved, and every failure with its reason, a
 * Retry and a Dismiss) is a lazy chunk, imported on the page's first write — as lib/islands/chart
 * loads Vega — so it costs a reading page nothing and stays out of the shared runtime's budget.
 */
import type { WriteStatusFeed } from '../contract';

export function installStatus(feed: WriteStatusFeed, root: HTMLElement): () => void {
  let disposed = false;
  let loading = false;
  let dispose = () => {};
  const mount = () => {
    if (loading) return;
    loading = true;
    import('./status-view').then(
      (view) => { if (!disposed) dispose = view.mountStatus(feed, root); },
      (error: unknown) => { loading = false; console.error('[islands] the write status indicator did not load', error); },
    );
  };
  const unsubscribe = feed.subscribe((statuses) => { if (statuses.length) mount(); });
  if (feed.current().length) mount();
  return () => {
    disposed = true;
    unsubscribe();
    dispose();
  };
}
