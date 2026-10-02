/**
 * THE MANAGED `<Iframe>`'S BEHAVIOUR, loaded lazily by the island (../embed.tsx) once it is mounted: the
 * managed frame (the former React ManagedIframeView's behaviour, framework-free) — the author content's
 * assets resolved first, then one sandboxed author realm (`allow-scripts`, its own locked document) bound
 * to the document's store through the author-script bridge (`window.mx`, signals, writes, comments).
 *
 * The store is the page's own; a document that declares no data has none, and the frame gets an empty one,
 * as the former runtime always hands it one.
 *
 * THE ASSET DOOR (pageAssetDoor) is the PAGE's, read here when a frame mounts, never compiled into the version:
 * the data island's `managedAssets` (the deployment's asset origin and this page's absolute import door, a
 * capture's key included), and — exactly when the document is framed — the relay to the parent page, which
 * holds the session an opaque frame cannot present (lib/story-runtime/entry: `transport.importAsset` is
 * present only on the relay). Top-level the resolver fetches the door itself, with the page's credentials.
 */
import { createManagedAssetResolver, prepareManagedContent, type ManagedAssetRelay, type ManagedAssetsConfig } from '@/lib/story-runtime/managed-assets';
import { startAuthorScript } from '@/lib/story-runtime/author-script';
import { managedAuthorDocument } from '@/lib/story-runtime/managed-author-document';
import { createRelayTransport } from '@/lib/story-runtime/relay-transport';
import { createDocumentTransport } from '@/lib/story-runtime/document-transport';
import { createDataflowStore, type DataflowStore } from '@/lib/story-runtime/store';
import type { ManagedIframeContent } from '@/lib/story/reader/managed-iframe';
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import type { IslandPageData } from '../../contract';
import { STORY_ASSET_MESSAGE, STORY_ASSET_RESULT_MESSAGE, type StoryAssetRequest } from '@/lib/story-runtime/contract';

export interface ManagedFrameMount {
  /** The frame box's inner element: the realm's iframe is mounted in it. */
  host: HTMLElement;
  compiled: ManagedIframeContent;
  store: DataflowStore | null;
  /** The frame's accessible name (managedFrameLayout). */
  label: string;
  /** A failure to start, as the former frame shows it (`role="alert"`, ≤ 500 characters). */
  onError(message: string): void;
}

/** Where this page's frames resolve their assets: its door, and the parent's relay when it is framed. */
export interface PageAssetDoor {
  assets?: ManagedAssetsConfig;
  importAsset?: ManagedAssetRelay;
}

/** The app's origin: where this engine was served from (a `/raw` copy's own origin is opaque). */
const appOrigin = (): string => { try { return new URL(import.meta.url).origin; } catch { return ''; } };

/** The page's asset door (IslandPageData.managedAssets) and, framed, the parent page's relay. */
export function pageAssetDoor(doc: Document, win: Window = doc.defaultView ?? window, origin: string = appOrigin()): PageAssetDoor {
  let data: Partial<IslandPageData> | null = null;
  try { data = JSON.parse(doc.getElementById(ISLAND_DATA_ID)?.textContent || 'null') as Partial<IslandPageData> | null; } catch { data = null; }
  const door = data?.managedAssets;
  const assets = door && typeof door.origin === 'string' && typeof door.resolveUrl === 'string' ? { origin: door.origin, resolveUrl: door.resolveUrl } : undefined;
  // The document transport's own rule (lib/story-runtime/document-transport): the relay exactly when framed.
  const importAsset = createDocumentTransport(win, undefined, origin, undefined, undefined, { relay: { eager: createRelayTransport } })?.importAsset;
  return { ...(assets ? { assets } : {}), ...(importAsset ? { importAsset } : {}) };
}

/** Answer only the managed frame this mount owns; its opaque origin cannot use the page's cookie. */
export function installFrameAssetRelay(doc: Document, host: HTMLElement, assets?: ManagedAssetsConfig): () => void {
  const win = doc.defaultView;
  if (!win || !assets) return () => {};
  const resolver = createManagedAssetResolver(assets);
  let disposed = false;
  const receive = (event: MessageEvent) => {
    const frame = host.querySelector('iframe');
    if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
    const data = event.data as Partial<StoryAssetRequest> | null;
    if (!data || data.type !== STORY_ASSET_MESSAGE || !Number.isSafeInteger(data.id) || (data.id ?? 0) < 1 || typeof data.url !== 'string') return;
    const kind = data.kind ?? 'image';
    if (!['image', 'font', 'pdf', 'script', 'binary'].includes(kind)) return;
    void resolver.resolve(data.url, kind).then(
      url => { if (!disposed) frame.contentWindow?.postMessage({ type: STORY_ASSET_RESULT_MESSAGE, id: data.id, url }, '*'); },
      () => { if (!disposed) frame.contentWindow?.postMessage({ type: STORY_ASSET_RESULT_MESSAGE, id: data.id, refused: 'asset_fetch_failed' }, '*'); },
    );
  };
  win.addEventListener('message', receive);
  return () => { disposed = true; win.removeEventListener('message', receive); resolver.dispose(); };
}

export function mountManagedFrame(mount: ManagedFrameMount): () => void {
  const doc = mount.host.ownerDocument;
  const own = mount.store ? null : createDataflowStore({ flow: { imports: [], values: [], queries: [], mutations: [] } });
  const store = mount.store ?? own!;
  const { assets, importAsset } = pageAssetDoor(doc);
  const resolver = createManagedAssetResolver(assets, importAsset);
  let disposed = false;
  let stop = () => {};
  const stopRelay = installFrameAssetRelay(doc, mount.host, assets);
  void prepareManagedContent(mount.compiled, resolver, doc).then((prepared) => {
    if (disposed) return;
    stop = startAuthorScript('', store, doc, { host: mount.host, title: mount.label, html: prepared.html, scripts: prepared.scripts, document: managedAuthorDocument(assets?.origin), assets, importAsset });
  }).catch((error: Error) => { if (!disposed) mount.onError(String(error.message).slice(0, 500)); });
  return () => {
    disposed = true;
    resolver.dispose();
    stopRelay();
    stop();
    mount.host.replaceChildren();
    own?.dispose();
  };
}
