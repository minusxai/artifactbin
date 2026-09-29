/**
 * SPLIT (probe): `fetchPageData` is the framework-free part of web/use-page-data.ts
 * (which imports React at module scope). The store (web/page-data-store.ts) and the
 * change events (web/page-data-events.ts, including REFRESH_EVENT) are already
 * framework-free and are imported unchanged.
 */
export async function fetchPageData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw Object.assign(new Error('Could not load page'), { status: response.status });
  return response.json() as Promise<T>;
}

/** "Re-read what this page shows" — an event, never a reload. Re-exported for existing importers. */
export { REFRESH_EVENT } from '@/web/page-data-events';
