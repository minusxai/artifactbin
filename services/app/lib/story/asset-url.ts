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
import type { JsxElement, JsxNode } from '@/lib/jsx';

/** What a `web_assets` row contributes to the markup: the box, and the blur to show inside it. */
export interface WebAssetBox {
  width?: number | null;
  height?: number | null;
  /** A ~100-byte `data:` URL stand-in (lib/images/optimise), or null for the tiny images that have none. */
  placeholder?: string | null;
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

/** The ONE deterministic function from a web URL to where we serve our copy. */
export function assetUrlFor(url: string): string {
  return `/assets/${urlHash(url)}`;
}

/** True for a URL this mapping is about at all: an absolute http(s) source. */
export const isWebUrl = (value: string): boolean => WEB_URL.test(value);

/**
 * The SAME mapping, for a URL that only exists in the READER's browser — the
 * value of a bound `<img src="$pick">`, a template a pick completed, a column
 * of logos, a line of author script.
 *
 * Publish imports every URL it can SEE; it cannot see these, so there are two
 * addresses rather than one and this chooses between them:
 *
 *  - `/assets/<hash>` once we know we hold a copy — which the caller learns by
 *    the browser having loaded it once, never by asking the server;
 *  - the document's own per-request endpoint otherwise
 *    (`/a/<id>/assets?u=<url>`), which imports it under that document's read
 *    ACL and its caps, and answers a redirect to the address above.
 *
 * Both are same-origin, so the served document's `img-src 'self'` admits them
 * and nothing about its CSP changes.
 *
 * NOTHING here may consult the server's `web_assets` index. This runs on BOTH
 * ends of the wire and the island carries no asset lookup, so a server that
 * knew a URL was cached would render one address while the hydrating client
 * rendered the other — which React answers by discarding the whole server tree
 * (#418). Both ends start knowing nothing; the browser learns, and only later
 * renders benefit.
 *
 * With no endpoint (a render that is not a served document — a rail preview, a
 * canvas) the URL comes back untouched and the caller decides; a non-web value
 * (a `data:` URL, a relative path) was never ours to map.
 */
export function runtimeAssetUrl(url: string, known: AssetLookup, endpoint: string | null | undefined): string {
  if (!isWebUrl(url)) return url;
  if (known(url)) return assetUrlFor(url);
  return endpoint ? `${endpoint}?u=${encodeURIComponent(url)}` : url;
}

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
export function mapExternalImageSources(nodes: JsxNode[], lookup: AssetLookup): JsxNode[] {
  let touches = false;
  walk(nodes, (el) => {
    for (const attr of imagePositionsOf(el)) {
      const url = webUrlAt(el, attr);
      if (url && lookup(url)) touches = true;
    }
  });
  if (!touches) return nodes;

  const clone: JsxNode[] = structuredClone(nodes);
  walk(clone, (el) => {
    for (const attr of imagePositionsOf(el)) {
      const url = webUrlAt(el, attr);
      if (!url) continue;
      const held = lookup(url);
      if (!held) continue;
      setAttr(el, attr, assetUrlFor(url));
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
  return css.replace(CSS_URL_RE, (whole, quote: string, url: string) =>
    (lookup(url) ? `url(${quote}${assetUrlFor(url)}${quote})` : whole));
}

/** The same positions, read rather than written — what the importer is asked to fetch. */
export function externalCssUrls(css: string): string[] {
  return [...new Set([...css.matchAll(CSS_URL_RE)].map((m) => m[2]))];
}
