/** The frame endpoint's client, shared by the app's document page and the document host module (./host-shell). */
import { retryingFetch } from '@/lib/http/retry-lazily';

/**
 * A fresh first URL for the document's frame (app/api/page/frame/[id]): a new one-time ticket carrying what only
 * this origin knows — the reader's "Allow once" grants (lib/trust/document-trust carriedTrust) — and the page's
 * `$` values. The served `src` cannot be reused: its ticket is spent.
 */
export async function freshFrameSrc(id: string, search = typeof window === 'undefined' ? '' : window.location.search): Promise<string | null> {
  try {
    const response = await retryingFetch(`/api/page/frame/${encodeURIComponent(id)}${search}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    const answer = await response.json() as { src?: unknown };
    return typeof answer.src === 'string' ? answer.src : null;
  } catch { return null; }
}
