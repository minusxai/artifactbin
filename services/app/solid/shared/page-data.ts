/**
 * SPLITS (probe), each the framework-free part of a React module that also holds hooks:
 * - `fetchPageData` from web/use-page-data.ts (which imports React at module scope);
 * - `REFRESH_EVENT` from lib/navigation.ts (which imports React and react-router).
 * The store itself (web/page-data-store.ts) and the change events (web/page-data-events.ts) are
 * already framework-free and are imported unchanged.
 */
export async function fetchPageData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw Object.assign(new Error('Could not load page'), { status: response.status });
  return response.json() as Promise<T>;
}

/** "Re-read what this page shows" — an event, never a reload (see lib/navigation). */
export const REFRESH_EVENT = 'mx:refresh';
