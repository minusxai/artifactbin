/**
 * Resolved reference data handed to the render tree: the server (or
 * the editor's client fetches) resolves each `ref:<id>` in an artifact to its
 * current content; the embeds consume this map — no network from inside the
 * surface beyond same-origin image URLs.
 */
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

/**
 * Recipes and images only: a DATASET is never page data — it is read through a
 * <Query> and only the query's result reaches the document (the island's
 * `dataflow`, lib/story/dataflow.ts).
 */
export type ResolvedRefData =
  | { kind: 'viz'; recipe: VizRecipeContent }
  /**
   * `width`/`height` are the image's INTRINSIC pixels, recorded when it was
   * stored (lib/images/optimise). They travel so the markup can reserve the
   * box before the bytes arrive — the difference between a page that settles
   * and a page that jumps under the reader. Absent for everything published
   * before the store began recording them, which simply reserves nothing, as
   * it always did.
   */
  | {
    kind: 'image'; url: string; width?: number; height?: number;
    /**
     * The narrow copy stored beside it (lib/images/optimise), at the same
     * artifact with `?w=` on it, and the width it was made at — the two halves
     * of a `srcset`. Absent for a narrow image, for everything published before
     * the variant existed, and for a CAPTURE render, which wants the full copy
     * and nothing to choose from.
     */
    smallUrl?: string; smallWidth?: number;
    /**
     * A ~95-byte blurred copy as a `data:` URL (lib/images/optimise), shown
     * under the image while the real bytes travel. Absent for more than a
     * third of stored images — the tiny ones, where a 16px thumbnail is
     * degenerate — so a missing blur is the ordinary case, not an edge one.
     */
    blur?: string;
  };

export type RefDataMap = Record<string, ResolvedRefData>;

/**
 * Where an image artifact's BYTES live — the one place this shape is written.
 *
 * `/raw` is the bytes; `/a/<id>` is the HTML page, which an <img> loads to
 * 0×0. `?v=<version>` changes when the bytes do, which is what lets /raw serve
 * them immutable. Both the render-time ref map (refDataForRow) and the create
 * echo the editor inserts from call this, so an image inserted live and one
 * rendered from storage can never point at different URLs.
 */
export const imageRawUrl = (id: string, version: number): string => `/a/${id}/raw?v=${version}`;

/** Where the narrow copy of the same image artifact lives: the same bytes, `?w=` apart. */
export const imageVariantUrl = (id: string, version: number, width: number): string =>
  `${imageRawUrl(id, version)}&w=${width}`;

/**
 * What the browser should assume an image is laid out at before any CSS has
 * loaded: the document column on a desktop, the whole viewport on a phone.
 *
 * ONE constant for both image paths — the `ref:` upload here and the URL-kept
 * copy in lib/story/asset-url — because they are the same picture in the same
 * column, and two numbers would be two answers to one question.
 */
export const IMAGE_SIZES = '(max-width: 640px) 100vw, 768px';

/**
 * `src="ref:<id>"` on an <img> → the referenced image artifact's same-origin
 * URL, or null when it does not resolve (deleted ref, wrong kind, plain URL).
 *
 * Render-output only: the AST keeps the `ref:` string as its source of truth,
 * so every write-back still round-trips the reference. Shared by BOTH render
 * paths — the WYSIWYG canvas (components/views/shared/StoryJsxBody) and the
 * served document's runtime (lib/story-runtime) — because an image that
 * resolves in one and not the other is exactly the drift this prevents.
 */
export function resolveRefImageSrc(src: unknown, refData: RefDataMap | undefined): string | null {
  if (typeof src !== 'string' || !src.startsWith('ref:')) return null;
  const r = refData?.[src.slice(4)];
  return r?.kind === 'image' ? r.url : null;
}

/**
 * Every position where markup carries an image `ref:<id>` that must become a
 * URL at render time, as ONE table: `src` on <img>, `poster` on <Video>. Both
 * render paths call this from their decorateElement seam and clone the patch
 * over the element, so a position resolving in the canvas and not the served
 * document (or vice versa) has nowhere to come from. Returns null when there
 * is nothing to patch — including an unresolved ref, which the component then
 * handles as its own fallback (the ref string is never a URL).
 */
const REF_IMAGE_POSITIONS: ReadonlyArray<{ component: boolean; tag: string; prop: string }> = [
  { component: false, tag: 'img', prop: 'src' },
  { component: true, tag: 'Video', prop: 'poster' },
];

/** What a resolved ref contributes: url and box as strings, the blur as a style object. */
export type RefPropPatch = Record<string, string | Record<string, string>>;

export function resolveRefProps(
  node: { isComponent: boolean; tag: string },
  props: Record<string, unknown>,
  refData: RefDataMap | undefined,
): RefPropPatch | null {
  const tag = node.isComponent ? node.tag : node.tag.toLowerCase();
  for (const pos of REF_IMAGE_POSITIONS) {
    if (pos.component !== node.isComponent || pos.tag !== tag) continue;
    const url = resolveRefImageSrc(props[pos.prop], refData);
    if (!url) continue;
    /*
     * Only a real <img> gets a box: a <Video> poster is a background, and
     * sizing it by the poster's own pixels would fight the player's layout.
     * And only when the author has said nothing — they mean what they wrote.
     */
    const ref = refData?.[String(props[pos.prop]).slice(4)];
    if (ref?.kind !== 'image' || pos.tag !== 'img') return { [pos.prop]: url };
    const sized: RefPropPatch = ref.width && ref.height && props.width === undefined && props.height === undefined
      ? { width: String(ref.width), height: String(ref.height) }
      : {};
    /*
     * BOTH WIDTHS, when both were stored — and never over an author's own
     * srcset, in either spelling they might have written it.
     */
    const widths: RefPropPatch = ref.smallUrl && ref.smallWidth && ref.width && ref.width > ref.smallWidth
      && props.srcSet === undefined && props.srcset === undefined
      ? { srcSet: `${ref.smallUrl} ${ref.smallWidth}w, ${ref.url} ${ref.width}w`, sizes: IMAGE_SIZES }
      : {};
    /*
     * THE BLUR, as a background on the image itself. The <img> is transparent
     * until its bytes paint, so this shows through and is covered the instant
     * they arrive — no JavaScript, identical in the SSR string, in hydration,
     * and in a prose document that ships no runtime.
     *
     * Skipped when the author wrote their own `style`: the patch is applied
     * with cloneElement and props merge SHALLOWLY, so ours would replace
     * theirs outright rather than merge. Everything is inline rather than a
     * class for the same reason — a className in the patch would clobber the
     * author's (`w-full rounded-md` on the image this was written for).
     */
    const patch: RefPropPatch = { [pos.prop]: url, ...sized, ...widths };
    if (ref.blur && props.style === undefined) {
      // An OBJECT, not a string: React rejects a string `style` prop, and both
      // render paths hand this straight to createElement.
      patch.style = {
        backgroundImage: `url(${ref.blur})`,
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
      };
    }
    return patch;
  }
  return null;
}
