/**
 * WHAT A DOCUMENT IS, ON THE WAY OUT — the one place stored source becomes the
 * tree a reader gets.
 *
 * There are three renderings of one document: the SSR string, the island the
 * client hydrates from, and the live frame an open reader adopts. The first two
 * are built by `lib/story/document.ts` and the third by
 * `lib/story/update-parts.ts`, and until this module existed each did the parse
 * → nesting repair → Helmet split for itself. Two copies of a transform whose
 * whole job is to make those renderings identical is the shape of the bug it
 * was written to prevent: the serve-time asset mapping landed in one of them
 * and a reader watching an agent write would have seen a different document
 * from the one a reload gives them.
 *
 * So the passes live here, in order, and both consumers call this:
 *   1. `fixHtmlNesting` — nesting the HTML parser will not undo (a `<p>` around
 *      a block parses back as a different tree, which React answers by
 *      discarding the whole server tree; every document published before the
 *      door existed is still stored with the fault).
 *   2. `splitHelmet` — `[Helmet?, ...body]`, the canonical shape.
 *   3. The ASSET MAPPING (lib/story/asset-url) — external image sources, and
 *      the `@font-face` urls in the author's own stylesheet, pointed at our
 *      copy. Above the split because both the body and the Helmet's style carry
 *      one.
 *
 * Pure: source in, tree out. No DOM, no I/O — `document.ts` imports `path` and
 * `module` and can never run in a browser, which is why this is its own module
 * rather than a function over there.
 */
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet, type HelmetContent } from '@/lib/story/helmet';
import { fixHtmlNesting } from '@/lib/story/nesting';
import { mapExternalCssUrls, mapExternalImageSources, type AssetLookup, type AssetMapOptions } from '@/lib/story/asset-url';

export interface StoryBody {
  /** The `<Helmet>`'s content — with its stylesheet already asset-mapped. */
  content: HelmetContent;
  /** The body nodes — the Helmet is never among them. */
  body: JsxNode[];
}

/**
 * Null when the source does not parse: a document that cannot be described is
 * not served or sent.
 *
 * `opts` is the mapping's, and there is exactly one of them: a CAPTURE render
 * wants every image eager and a single `src` (lib/story/asset-url). It travels
 * here rather than being decided here, because this module knows what a
 * document IS and not who is looking at it.
 */
export function storyBodyFor(source: string, assets?: AssetLookup, opts?: AssetMapOptions): StoryBody | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const { content, body } = splitHelmet(fixHtmlNesting(parsed.nodes));
  if (!assets) return { content, body };
  return {
    content: content.style ? { ...content, style: mapExternalCssUrls(content.style, assets) } : content,
    body: mapExternalImageSources(body, assets, opts),
  };
}
