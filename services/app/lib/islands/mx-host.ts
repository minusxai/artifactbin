/**
 * The public page API (`window.mx`) lives behind boot's and page's lazy boundary (a standalone chunk,
 * scripts/build-islands STANDALONE_LAZY: framework-free, so it imports no Solid).
 */
import { createMx } from '@/lib/story-runtime/mx';
import type { DataflowStore } from '@/lib/story-runtime/store';
import { PUBLIC_MX_KEY, type PublicMxHost } from './contract';

export const publicMxFor = (store: DataflowStore) => createMx(store);

/**
 * Install `win.mx` over this document's store, replacing any earlier install on the same root, and leave
 * its uninstaller on the root under `PUBLIC_MX_KEY` (boot calls it on edit and dispose). Nothing is
 * installed when the store was disposed or `live()` says the document no longer reads (it entered edit
 * mode, or left the page) by the time this chunk loaded. The uninstaller removes only its own API.
 */
export function installPublicMx(root: HTMLElement, store: DataflowStore, win: Window, live: () => boolean): () => void {
  const host = root as PublicMxHost;
  if (store.disposed || !live()) return () => {};
  host[PUBLIC_MX_KEY]?.();
  const api = publicMxFor(store);
  const uninstall = () => {
    if (win.mx === api) delete win.mx;
    if (host[PUBLIC_MX_KEY] === uninstall) delete host[PUBLIC_MX_KEY];
  };
  host[PUBLIC_MX_KEY] = uninstall;
  win.mx = api;
  return uninstall;
}
