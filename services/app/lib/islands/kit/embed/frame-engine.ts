/**
 * THE MANAGED `<Iframe>`'S BEHAVIOUR, loaded lazily by the island (../embed.tsx) once it is mounted: today's
 * managed frame (lib/story-runtime/managed-iframe ManagedIframeView) without React — the author content's
 * assets resolved first, then one sandboxed author realm (`allow-scripts`, its own locked document) bound
 * to the document's store through the author-script bridge (`window.mx`, signals, writes, comments).
 *
 * The store is the page's own; a document that declares no data has none, and the frame gets an empty one,
 * as today's runtime always hands it one.
 */
import { createManagedAssetResolver, prepareManagedContent, type ManagedAssetsConfig } from '@/lib/story-runtime/managed-assets';
import { startAuthorScript } from '@/lib/story-runtime/author-script';
import { managedAuthorDocument } from '@/lib/story-runtime/managed-author-document';
import { createDataflowStore, type DataflowStore } from '@/lib/story-runtime/store';
import type { ManagedIframeContent } from '@/lib/story/managed-iframe';

export interface ManagedFrameMount {
  /** The frame box's inner element: the realm's iframe is mounted in it. */
  host: HTMLElement;
  compiled: ManagedIframeContent;
  store: DataflowStore | null;
  /** The frame's accessible name (managedFrameLayout). */
  label: string;
  assets?: ManagedAssetsConfig;
  /** A failure to start, as today's frame shows it (`role="alert"`, ≤ 500 characters). */
  onError(message: string): void;
}

export function mountManagedFrame(mount: ManagedFrameMount): () => void {
  const doc = mount.host.ownerDocument;
  const own = mount.store ? null : createDataflowStore({ flow: { imports: [], values: [], queries: [], mutations: [] } });
  const store = mount.store ?? own!;
  const resolver = createManagedAssetResolver(mount.assets);
  let disposed = false;
  let stop = () => {};
  void prepareManagedContent(mount.compiled, resolver, doc).then((prepared) => {
    if (disposed) return;
    stop = startAuthorScript('', store, doc, { host: mount.host, title: mount.label, html: prepared.html, scripts: prepared.scripts, document: managedAuthorDocument(mount.assets?.origin), assets: mount.assets });
  }).catch((error: Error) => { if (!disposed) mount.onError(String(error.message).slice(0, 500)); });
  return () => {
    disposed = true;
    resolver.dispose();
    stop();
    mount.host.replaceChildren();
    own?.dispose();
  };
}
