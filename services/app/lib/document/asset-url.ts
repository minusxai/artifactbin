import {sha256Hex} from '@artifactbin/utils/sha256';
export interface WebAssetBox {
  width?: number | null;
  height?: number | null;
  /** A ~100-byte `data:` URL stand-in (lib/images/optimise), or null for the tiny images that have none. */
  placeholder?: string | null;
  /** Where the bytes are (`webasset/<hex>`) — what the `?v=` below is cut from. */
  object_key?: string | null;
  /** The 640-wide copy stored beside it, for sources wide enough to need one (lib/images/optimise). */
  small_object_key?: string | null;
  small_width?: number | null;
}

/** WHATWG normalization, so a case- or default-port-only difference is not a second cached object. */
export function canonicalAssetUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/** sha256 of the canonical URL — the `web_assets` primary key and the last path segment of the address below. */
export const urlHash = (url: string): string => sha256Hex(canonicalAssetUrl(url));

/**
 * THE CACHE KEY, cut from the object the row points at.
 *
 * `/assets/<hash>` is served `immutable` for a year and its address is derived
 * from the URL, so a `refresh_asset` that repoints the row reaches nobody whose
 * browser already has the old bytes. The address cannot move — a stored
 * document names the URL, and every rendering derives the address from it — so
 * the QUERY moves instead: eight hex of the content-addressed object key, which
 * changes exactly when the bytes do and never otherwise. The route ignores it
 * (it is a cache key, not an input): a browser holding the old url keeps a
 * perfectly valid year-long entry, and the next render simply asks for a url it
 * has never seen. Nothing is invalidated by anything but a real change.
 */
const assetVersion = (objectKey: string | null | undefined): string | null => {
  const digest = (objectKey ?? '').split('/').pop() ?? '';
  return /^[0-9a-f]{8}/.test(digest) ? digest.slice(0, 8) : null;
};

/**
 * The ONE deterministic function from a web URL to where we serve our copy.
 *
 * The second argument is what the CALLER holds: a row (the serving paths, which
 * looked the assets up to render at all) versions the address; a bare predicate
 * (the editor's own push, which has no rows to consult) gets the unversioned
 * address, which serves the same bytes and only misses the cache-busting.
 */
export function assetUrlFor(url: string, held?: WebAssetBox | boolean | null): string {
  const base = `/assets/${urlHash(url)}`;
  const v = held && typeof held === 'object' ? assetVersion(held.object_key) : null;
  return v ? `${base}?v=${v}` : base;
}
