/**
 * THE WEB ASSETS A PAGE SERVES ON ITS OWNER'S HOST: `meta.webAssets`, the `web_assets` keys (urlHash) of the
 * http(s) images its stored source names (lib/html-page htmlAssetLinks imageUrls: img/source src, video poster;
 * never fonts, PDFs or links). The owner host answers `/assets/<hash>` only for a hash one of the owner's
 * eligible pages lists (lib/user-pages servesWebAsset, an indexed `meta->'webAssets' ? hash`).
 *
 * Derived from the stored source at the store's two content writes (create, publish), so a replace and a revert
 * (which publishes the restored version) always carry the set of the source they store. A page without the key
 * serves no web image.
 */
import { urlHash } from '@/lib/document';
import { htmlAssetLinks } from '@/lib/html-page';

/** The sorted, distinct `web_assets` keys of the images an HTML source names. */
export function webAssetHashes(source: string | null): string[] {
  return [...new Set(htmlAssetLinks(source ?? '').imageUrls.map(urlHash))].sort();
}

/** The meta a content write stores: an HTML page's carries the set of the source it stores, any other format none. */
export function withWebAssets(format: string, source: string | null | undefined, meta: Record<string, unknown>): Record<string, unknown> {
  const { webAssets: _derived, ...rest } = meta;
  return format === 'html' ? { ...rest, webAssets: webAssetHashes(source ?? null) } : rest;
}
