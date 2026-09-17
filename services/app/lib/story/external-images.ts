/**
 * WHICH EXTERNAL URLs A DOCUMENT NAMES — the pure half of importing them.
 *
 * Two positions hold an image the document must own: `<img src>` and
 * `<Video poster>`, the two places refs.ts treats as image refs; ONE holds a
 * PDF, `<File src>`, which is imported the same way under its own cap. A web URL
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
import { carriesRef } from '@/lib/story/dataflow';

const WEB_URL = /^https?:\/\//i;

/** [element tag, attribute] pairs that hold an image the document must own. */
const IMAGE_POSITIONS: ReadonlyArray<readonly [tag: string, attr: string, component: boolean]> = [
  ['img', 'src', false],
  ['Video', 'poster', true],
];

/** The one position that holds a PDF: the card that links it. */
const PDF_POSITIONS: ReadonlyArray<readonly [tag: string, attr: string, component: boolean]> = [
  ['File', 'src', true],
];

const walk = (nodes: JsxNode[], visit: (el: JsxElement) => void): void => {
  for (const n of nodes) {
    if (n.type !== 'element') continue;
    visit(n);
    walk(n.children, visit);
  }
};

const attrsAt = (
  el: JsxElement,
  positions: ReadonlyArray<readonly [tag: string, attr: string, component: boolean]>,
): Array<{ attr: JsxElement['attributes'][number]; value: string }> =>
  positions
    .filter(([tag, , component]) => el.isComponent === component && (component ? el.tag === tag : el.tag.toLowerCase() === tag))
    .map(([, attr]) => el.attributes.find((a) => a.name.toLowerCase() === attr.toLowerCase()))
    .flatMap((a) => (a && a.value.static && typeof a.value.json === 'string' ? [{ attr: a, value: a.value.json }] : []));

/**
 * Both kinds at once, in the shape the importer and the serve-time lookup want.
 *
 * ONE parse: this runs on EVERY read of every document (the raw route and the
 * live frame ask it before they render), including the overwhelming majority
 * that name nothing external, so parsing the source twice to answer two
 * questions about the same tree is a per-read cost paid by documents that do
 * not use the feature at all.
 */
export function collectExternalAssetUrls(source: string): { images: string[]; fonts: string[]; pdfs: string[]; all: string[] } {
  const parsed = parseJsx(source);
  if (!parsed.ok) return { images: [], fonts: [], pdfs: [], all: [] }; // the jsx validator owns reporting a parse failure
  const images: string[] = [];
  const pdfs: string[] = [];
  walk(parsed.nodes, (el) => {
    for (const { value } of attrsAt(el, IMAGE_POSITIONS)) {
      /*
       * A URL carrying a REFERENCE is not a URL publish can fetch:
       * `https://cdn.x.com/{$pick}.png` names a FAMILY of images, one of which
       * exists once a reader has picked something. Fetching it literally is
       * what happened before this line — a request for `/%7B$pick%7D.png`, a
       * 404, and a warning about a URL nobody wrote. Those are imported on
       * first view by the document's own asset endpoint instead
       * (app/a/[id]/assets); the whole-attribute form (`src="$pick"`) is not a
       * web URL at all and never reached here.
       *
       * The IMAGE loop only: a `<File src>` is a literal URL an author wrote,
       * with no binding syntax of its own, so publish fetches it as it always
       * did.
       */
      if (WEB_URL.test(value) && !carriesRef(value) && !images.includes(value)) images.push(value);
    }
    for (const { value } of attrsAt(el, PDF_POSITIONS)) {
      if (WEB_URL.test(value) && !pdfs.includes(value)) pdfs.push(value);
    }
  });
  const style = splitHelmet(parsed.nodes).content.style;
  const fonts = style ? externalCssUrls(style) : [];
  return { images, fonts, pdfs, all: [...new Set([...images, ...fonts, ...pdfs])] };
}

/** Every web URL in an image position, deduplicated, in document order. */
export const collectExternalImageUrls = (source: string): string[] => collectExternalAssetUrls(source).images;

/**
 * Every web URL in an `@font-face` `src` in the document's own stylesheet.
 * Scoped to `@font-face` because that is the only external url() the door
 * admits at all (lib/data/story/banned-css): everything else in authored CSS is
 * still stripped, and a font is the one case where the alternative — silently
 * dropping it — published a document that looked like it worked and had lost
 * its typeface.
 */
export const collectExternalFontUrls = (source: string): string[] => collectExternalAssetUrls(source).fonts;
