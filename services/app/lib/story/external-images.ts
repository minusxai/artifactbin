/**
 * WHICH EXTERNAL URLs A DOCUMENT NAMES — the pure half of importing them.
 *
 * Two positions hold an image the document must own: `<img src>` and
 * `<Video poster>`, the two places refs.ts treats as image refs. A web URL
 * anywhere else keeps whatever meaning the validator gives it (`href` is
 * navigation; other subresource attributes stay rejected as non-self-contained)
 * — and ONE css position holds a face the document self-hosts:
 * `@font-face { src: url(https://…) }` inside the author's own `<Helmet>`
 * stylesheet.
 *
 * The DOOR (jsx-tier) collects these and IMPORTS them (lib/web-assets) before
 * validation. It does NOT rewrite the source: the URL an author wrote stays in
 * the stored document, and the serve-time mapping (lib/story/asset-url) points
 * the served copy at ours. That replaced a rewrite to `ref:<id>`, which created
 * an image artifact the agent never asked for and made the document's own
 * markup unrecognisable to whoever wrote it.
 */
import { parseJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { externalCssUrls } from '@/lib/story/asset-url';

const WEB_URL = /^https?:\/\//i;

/** [element tag, attribute] pairs that hold an image the document must own. */
const IMAGE_POSITIONS: ReadonlyArray<readonly [tag: string, attr: string, component: boolean]> = [
  ['img', 'src', false],
  ['Video', 'poster', true],
];

const walk = (nodes: JsxNode[], visit: (el: JsxElement) => void): void => {
  for (const n of nodes) {
    if (n.type !== 'element') continue;
    visit(n);
    walk(n.children, visit);
  }
};

const imageAttrsOf = (el: JsxElement): Array<{ attr: JsxElement['attributes'][number]; value: string }> =>
  IMAGE_POSITIONS
    .filter(([tag, , component]) => el.isComponent === component && (component ? el.tag === tag : el.tag.toLowerCase() === tag))
    .map(([, attr]) => el.attributes.find((a) => a.name.toLowerCase() === attr.toLowerCase()))
    .flatMap((a) => (a && a.value.static && typeof a.value.json === 'string' ? [{ attr: a, value: a.value.json }] : []));

/** Every web URL in an image position, deduplicated, in document order. */
export function collectExternalImageUrls(source: string): string[] {
  const parsed = parseJsx(source);
  if (!parsed.ok) return []; // the jsx validator owns reporting a parse failure
  const urls: string[] = [];
  walk(parsed.nodes, (el) => {
    for (const { value } of imageAttrsOf(el)) {
      if (WEB_URL.test(value) && !urls.includes(value)) urls.push(value);
    }
  });
  return urls;
}

/**
 * Every web URL in an `@font-face` `src` in the document's own stylesheet.
 * Scoped to `@font-face` because that is the only external url() the door
 * admits at all (lib/data/story/banned-css): everything else in authored CSS is
 * still stripped, and a font is the one case where the alternative — silently
 * dropping it — published a document that looked like it worked and had lost
 * its typeface.
 */
export function collectExternalFontUrls(source: string): string[] {
  const parsed = parseJsx(source);
  if (!parsed.ok) return [];
  const style = splitHelmet(parsed.nodes).content.style;
  return style ? externalCssUrls(style) : [];
}

/** Both kinds at once, in the shape the importer and the serve-time lookup both want. */
export function collectExternalAssetUrls(source: string): { images: string[]; fonts: string[]; all: string[] } {
  const images = collectExternalImageUrls(source);
  const fonts = collectExternalFontUrls(source);
  return { images, fonts, all: [...new Set([...images, ...fonts])] };
}
