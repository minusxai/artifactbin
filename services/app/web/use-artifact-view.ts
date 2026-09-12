import { useEffect, useRef } from 'react';

/** One report per mounted document, independent of bootstrap/cache/network data.
 * The page is keyed by artifact identity. StrictMode, data refreshes and URL
 * selections must not report again; returning after unmount is a new open.
 * Delivery is best effort and never blocks the reader or retries a failed open.
 */
export function useArtifactView(id: string, readable: boolean): void {
  const reported = useRef(false);
  useEffect(() => {
    if (!readable || reported.current) return;
    reported.current = true;
    void fetch(`/api/page/artifact/${id}/view`, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
  }, [id, readable]);
}
