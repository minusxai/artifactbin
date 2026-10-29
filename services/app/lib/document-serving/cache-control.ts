/**
 * EVERY CACHE POLICY this module answers with, decided here: what a browser and a shared cache may keep of a
 * document, its stored bytes, the runtime it loads and the app pages around it. A shared cache may hold only what
 * everyone may read; anything that depends on who asks, and every refusal, is never kept.
 */
import { REVALIDATE } from '@/lib/http';

/** Never kept: an answer that depends on who asks, a refusal, or a failure. */
export const NO_STORE = 'no-store';
/** Kept privately and asked again on every use with its validator (a document on its own origin, a node answer). */
export { REVALIDATE };
/** Kept, and asked again on every use (a hosted component entry, whose address carries no version). */
export const NO_CACHE = 'no-cache';
/** Public bytes whose address names them (a content-addressed chunk or retained runtime): they never change for it. */
export const PUBLIC_IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * The cache policy of a stored image or PDF's own bytes (/raw): a versioned address (`?v=<n>`) is immutable,
 * a bare one might be replaced under the same id and only gets a short freshness window; a shared cache may
 * hold only what everyone may read.
 */
export function storedBytesCacheControl(row: {visibility: string}, versioned: boolean): string {
  const scope = row.visibility === 'public' ? 'public' : 'private';
  return versioned ? `${scope}, max-age=31536000, immutable` : `${scope}, max-age=300`;
}

/**
 * A runtime stylesheet's (./runtime-css.server): immutable for its URL when compiled in the environment that URL
 * names (public when `anyone` may read the document), otherwise this deploy's sheet, uncached.
 */
export function runtimeCssCacheControl(current: boolean, anyone: boolean): string {
  return current ? `${anyone ? 'public' : 'private'}, max-age=31536000, immutable` : 'private, no-cache';
}
