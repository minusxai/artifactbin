/**
 * THE SERVE-TIME MAPPING for URL-kept external assets — pure, and the only
 * module that knows the address our copy of a web URL lives at.
 *
 * The stored markup keeps `<img src="https://…">` exactly as its author wrote
 * it: an agent writes a URL, reads its document back, and finds the URL. What
 * a READER is served must still come from this origin — the document's CSP is
 * `img-src 'self' data: blob:` and `font-src 'self' data:`, and the point of
 * importing at all is that opening a document sends nothing to a third party —
 * so the tree is rewritten on the way OUT, above the Helmet split, where
 * `fixHtmlNesting` already sits. One pass, one tree: the SSR string, the island
 * the client hydrates from, the renderer's own `<link rel=preload as=image>`
 * and the live frame an open reader adopts all derive from it, and there is
 * nowhere left for them to disagree.
 *
 * No DB, no I/O, no `node:crypto` (lib/sha256): `lib/story/update-parts.ts`
 * calls this and `components/InPlaceEditor.tsx` imports THAT, so everything
 * here lands in the browser bundle.
 *
 * The lookup is what the caller holds. A PREDICATE is enough when all that is
 * known is that we hold a copy (the editor's own push, a test); a BOX carries
 * what the row recorded, and an `<img>` that gets one reserves its space before
 * the bytes arrive — URL-keeping without it is a layout-shift regression
 * against the `ref:` path, which has carried width/height/blur since the store
 * began measuring images.
 */
import { sha256Hex } from '@/lib/sha256';
import { IMAGE_SIZES } from '@/lib/story/ref-data';
import type { JsxElement, JsxNode } from '@/lib/jsx';

/**
 * What a `web_assets` row contributes to the markup: the box, the blur to show
 * inside it, the object behind it, and the narrow copy stored beside it.
 *
 * The field names are the ROW's, so a `Map<string, WebAssetRow>` is already a
 * lookup index — no translation step, and so no translation step to drop a
 * field on one serving path and keep it on another.
 */
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

/**
 * "Do we hold a copy of this URL, and what do we know about it?" — `false`,
 * `null` or `undefined` mean no; anything truthy means yes, and a box says how
 * big it is.
 */
export type AssetLookup = (url: string) => WebAssetBox | boolean | null | undefined;

/** The same positions lib/story/external-images.ts owns: `<img src>`, `<Video poster>`. */
const IMAGE_POSITIONS: ReadonlyArray<readonly [tag: string, attr: string, component: boolean]> = [
  ['img', 'src', false],
  ['Video', 'poster', true],
];

const WEB_URL = /^https?:\/\//i;

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
 * browser already has the old bytes (R19). The address cannot move — a stored
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

/**
 * The narrow copy's address: the same asset, `w=` the width that was stored.
 *
 * One route, one row, one query parameter — rather than a second hash — because
 * the variant is not a second ASSET: it is the same URL's bytes at a second
 * size, it moves when the row moves, and a refresh must invalidate both with
 * one `?v=`.
 */
const assetVariantUrl = (url: string, box: WebAssetBox): string =>
  `${assetUrlFor(url, box)}${box.object_key ? '&' : '?'}w=${box.small_width}`;

/** The two widths a wide image offers, or null when only one copy was ever stored. */
function assetSrcSet(url: string, box: WebAssetBox): string | null {
  const { width, small_width: small } = box;
  if (!box.small_object_key || !small || !width || width <= small) return null;
  return `${assetVariantUrl(url, box)} ${small}w, ${assetUrlFor(url, box)} ${width}w`;
}

/*
 * The `sizes` hint is lib/story/ref-data's IMAGE_SIZES: the same picture in the
 * same column, whether its bytes came from an upload or from a URL. It is wrong
 * for a full-bleed image on a wide screen — which simply gets the full variant,
 * the one it would have had with no `srcset` at all — and right for the
 * ordinary case, which is an image in the document column.
 */

/** How many images at the top of a document are assumed to be in the first viewport. */
const EAGER_IMAGES = 2;

/** What varies between a document a person reads and a frame /export photographs. */
export interface AssetMapOptions {
  /**
   * A CAPTURE render (`chrome=0`): one `src`, the full variant, nothing lazy.
   * /export photographs this frame, so a lazy image is a photograph of nothing
   * and a `sizes` hint against a headless viewport is a photograph of the
   * 640px copy. ONE flag rather than three, because they are one decision.
   */
  capture?: boolean;
}

/** True for a URL this mapping is about at all: an absolute http(s) source. */
export const isWebUrl = (value: string): boolean => WEB_URL.test(value);

/** A lookup over whatever index the caller already has — a Set of urls, or the rows themselves. */
export const assetLookupFrom = (index: ReadonlySet<string> | ReadonlyMap<string, WebAssetBox>): AssetLookup =>
  (url: string) => ('get' in index ? index.get(url) ?? false : index.has(url));

const walk = (nodes: JsxNode[], visit: (el: JsxElement) => void): void => {
  for (const n of nodes) {
    if (n.type !== 'element') continue;
    visit(n);
    walk(n.children, visit);
  }
};

const imagePositionsOf = (el: JsxElement): string[] =>
  IMAGE_POSITIONS
    .filter(([tag, , component]) => el.isComponent === component && (component ? el.tag === tag : el.tag.toLowerCase() === tag))
    .map(([, attr]) => attr);

const attrOf = (el: JsxElement, name: string) => el.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());

const webUrlAt = (el: JsxElement, attr: string): string | null => {
  const a = attrOf(el, attr);
  if (!a || !a.value.static || typeof a.value.json !== 'string') return null;
  return WEB_URL.test(a.value.json) ? a.value.json : null;
};

/** Set an attribute's static value, adding the attribute when the author wrote none. */
function setAttr(el: JsxElement, name: string, json: string | Record<string, string>): void {
  const existing = attrOf(el, name);
  if (existing) {
    existing.value = { static: true, json };
    return;
  }
  el.attributes.push({ name, value: { static: true, json }, start: el.start, end: el.start });
}

/**
 * Rewrite every web URL in an image position to our asset address WHEN the
 * lookup says we hold a copy, and give a real `<img>` the box the row recorded.
 * A URL we do not hold is LEFT ALONE — a document published before the import
 * ran, or a URL the importer refused (the publish reply carried the warning),
 * renders as it did: the browser draws the alt text, and the document's CSP
 * means the reader's browser never reaches the upstream host for it.
 *
 * Returns the SAME array when nothing matched: this runs on every render of
 * every document, and a document with no external assets must not pay a clone.
 */
export function mapExternalImageSources(nodes: JsxNode[], lookup: AssetLookup, opts: AssetMapOptions = {}): JsxNode[] {
  let touches = false;
  walk(nodes, (el) => {
    for (const attr of imagePositionsOf(el)) {
      const url = webUrlAt(el, attr);
      if (url && lookup(url)) touches = true;
    }
  });
  if (!touches) return nodes;

  /*
   * WHERE IN THE DOCUMENT an image is, counted over EVERY `<img>` and not only
   * the mapped ones: what decides whether a browser may wait for the bytes is
   * how far down the page they are, and an upload above a URL-kept image
   * occupies the fold just as well as anything else does.
   */
  let seen = 0;
  const clone: JsxNode[] = structuredClone(nodes);
  walk(clone, (el) => {
    const isImg = !el.isComponent && el.tag.toLowerCase() === 'img';
    const position = isImg ? seen++ : -1;
    for (const attr of imagePositionsOf(el)) {
      const url = webUrlAt(el, attr);
      if (!url) continue;
      const held = lookup(url);
      if (!held) continue;
      setAttr(el, attr, assetUrlFor(url, held));
      /*
       * The box and the blur, on the SAME rule lib/story/ref-data
       * `resolveRefProps` applies to a `ref:` image, and for the same reasons:
       * only a real <img> (a <Video> poster is a background, and sizing it by
       * the poster's pixels would fight the player's layout), and only where
       * the author said nothing — they mean what they wrote.
       */
      if (attr !== 'src' || el.isComponent || typeof held !== 'object') continue;
      const sized = held.width && held.height && !attrOf(el, 'width') && !attrOf(el, 'height');
      if (sized) {
        setAttr(el, 'width', String(held.width));
        setAttr(el, 'height', String(held.height));
      }
      if (held.placeholder && !attrOf(el, 'style')) {
        // An OBJECT, not a css string: both render paths hand this straight to
        // createElement, and React rejects a string `style` prop.
        setAttr(el, 'style', {
          backgroundImage: `url(${held.placeholder})`,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
        });
      }
      if (opts.capture) continue;
      /*
       * TWO WIDTHS, and the browser picks. `srcSet` in React's own spelling
       * rather than the HTML one: measured through the SSR renderer, a
       * lowercase `srcset` reaches the DOM but React does not RECOGNISE it, so
       * its own `<link rel=preload as=image>` preloads the full `href` and the
       * phone downloads the desktop copy before it downloads the one it will
       * use. The author's own srcset wins, as their width and style do.
       */
      const srcSet = attrOf(el, 'srcset') || attrOf(el, 'sizes') ? null : assetSrcSet(url, held);
      if (srcSet) {
        setAttr(el, 'srcSet', srcSet);
        setAttr(el, 'sizes', IMAGE_SIZES);
      }
      /*
       * LET THE BROWSER WAIT for everything but the first viewport. `lazy` also
       * suppresses React's preload of that image (measured), which is the
       * point: preloading what a reader may never scroll to is the same cost
       * in a different place.
       */
      if (position >= EAGER_IMAGES && !attrOf(el, 'loading')) {
        setAttr(el, 'loading', 'lazy');
        if (!attrOf(el, 'decoding')) setAttr(el, 'decoding', 'async');
      }
    }
  });
  return clone;
}

/**
 * The same mapping for the ONE css position that may name a web URL: the `src`
 * of an `@font-face` in the author's own `<Helmet><style>`. Publish imports
 * those faces (lib/web-assets) and this points them at our copy, so a document
 * that names a self-hosted font paints it without the reader's browser ever
 * touching the host it came from.
 *
 * Everything else in authored CSS is still stripped at the door
 * (lib/data/story/banned-css) — this rewrites what survived, and leaves a URL
 * we do not hold exactly as it is: the document's `font-src 'self' data:`
 * refuses to load it, which is the same closed door the strip was.
 */
const CSS_URL_RE = /url\(\s*(['"]?)(https?:\/\/[^'")\s]+)\1\s*\)/gi;

export function mapExternalCssUrls(css: string, lookup: AssetLookup): string {
  return css.replace(CSS_URL_RE, (whole, quote: string, url: string) => {
    // The row, kept — not just "do we hold it": a face is served from the same
    // `immutable` address an image is, so a REFRESHED font needs the same
    // content-derived `?v=` or it reaches nobody who already loaded the old one
    // (R19). `refresh_asset` refreshes fonts exactly as it refreshes pictures.
    const held = lookup(url);
    return held ? `url(${quote}${assetUrlFor(url, held)}${quote})` : whole;
  });
}

/** The same positions, read rather than written — what the importer is asked to fetch. */
export function externalCssUrls(css: string): string[] {
  return [...new Set([...css.matchAll(CSS_URL_RE)].map((m) => m[2]))];
}
