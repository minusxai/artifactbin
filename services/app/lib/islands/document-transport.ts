/** The compiled reader's transport selector: a top-level page needs only the fetch door. */
import { createFetchTransport } from '@/lib/story-runtime/fetch-transport';
import type { QueryTransport } from '@/lib/story-runtime/store';

export function createIslandDocumentTransport(win: Window, queryUrl: string | undefined, appOrigin: string, mutateUrl: string | undefined, signedIn: boolean): QueryTransport | null {
  const parent = win.parent;
  if (parent && parent !== win && parent !== win.self) {
    // The framed reader retains the parent's session. It can wait for the relay module
    // on its first request; all requests share one instance and its message listeners.
    const relay = import('@/lib/story-runtime/relay-transport').then(({ createRelayTransport }) => createRelayTransport(parent, appOrigin, win));
    return {
      run: async (...args) => (await relay).run(...args),
      page: async (...args) => (await relay).page(...args),
      mutate: async (...args) => (await relay).mutate!(...args),
      importAsset: async (...args) => (await relay).importAsset!(...args),
    };
  }
  return queryUrl ? createFetchTransport(queryUrl, undefined, mutateUrl, { session: signedIn }) : null;
}
