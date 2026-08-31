/**
 * Publish-time image importing, the PURE half: which web URLs a document
 * carries in its IMAGE positions, and the rewrite once they have been
 * ingested. Position-scoped to `<img src>` and `<Video poster>` — the two
 * places refs.ts treats as image refs. A web URL anywhere else keeps whatever
 * meaning the validator gives it (`href` is navigation; other subresource
 * attrs stay rejected as non-self-contained).
 *
 * The DOOR (jsx-tier) runs collect → ingest (lib/artifacts imageIngestorFor)
 * → rewrite, before validation, so the validated and stored document already
 * reads `ref:<id>` — the same rewritten-not-rejected stance as the `<p><div>`
 * canonicalization, and for the same reason: agents emit web image URLs
 * constantly, and the echo teaches them what their document became.
 */
import { parseJsx, serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';

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

/** The same positions, each URL replaced by the ref it became. */
export function rewriteExternalImages(source: string, refs: Map<string, string>): string {
  if (refs.size === 0) return source;
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  let touched = false;
  walk(parsed.nodes, (el) => {
    for (const { attr, value } of imageAttrsOf(el)) {
      const id = refs.get(value);
      if (id) {
        attr.value = { static: true, json: `ref:${id}` };
        touched = true;
      }
    }
  });
  return touched ? serializeJsx(parsed.nodes) : source;
}
