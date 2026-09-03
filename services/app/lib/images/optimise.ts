/**
 * WHAT AN UPLOAD BECOMES.
 *
 * An image arrives as whatever came off someone's phone, and a reader waits
 * for exactly that. Measured on production: one photograph in one document was
 * 1.04 MB — twenty times the whole gzipped page around it — encoded BASELINE,
 * so it painted top to bottom over several seconds, in markup with no width or
 * height, so the page jumped when it landed. The serving was never at fault
 * (4ms from the box). The file was.
 *
 * So this is the one place an image is made fit to read: capped, converted,
 * measured, and given a stand-in to show while it travels. It runs at PUBLISH,
 * behind lib/story/data-tiers storeImageContent — the single door the picker,
 * the paste/drop and the URL import all already share — because the first
 * reader of a document is the person its author just handed the link to, and
 * they must not be the one paying for an encode.
 *
 * The floor under every rule here: NEVER RETURN SOMETHING WORSE THAN WHAT WAS
 * GIVEN. A conversion that comes out bigger is discarded, an image that will
 * not decode is passed through untouched, and formats where re-encoding loses
 * something real — SVG is text and scales, an animated GIF would be frozen —
 * are not touched at all.
 *
 * WebP alone, deliberately: it has been in every browser since 2020, so a
 * second format would buy nothing but an `Accept` negotiation and a `Vary`
 * header, which is the part that goes wrong with caches. AVIF is left for
 * later — several times the encode cost for perhaps a fifth more saving, paid
 * on every publish.
 */
import sharp from 'sharp';
import type { Metadata, OutputInfo } from 'sharp';

/**
 * The long edge past which nothing needs to be shipped for reading on a screen.
 *
 * THE CAP IS THE LEVER, measured on the 1.04 MB photograph that started this
 * (1700×1687, already under it, so nothing is resized):
 *
 *   cap 2048 · q82 → 946 KB (11%)   cap 1600 · q82 → 803 KB (25%)
 *   cap 2048 · q78 → 846 KB (21%)   cap 1600 · q78 → 713 KB (33%)
 *   cap 2048 · q72 → 765 KB (28%)   cap 1280 · q78 → 458 KB (57%)
 *
 * 2048 is the quality-safe choice: the document column is about 850px, so it
 * is ~2.4× there and still over 1× for a full-bleed image on a wide screen.
 * Dropping to 1600 buys another 14 points and starts to cost a full-bleed
 * image its sharpness on a retina display, which is a decision about the
 * product rather than about bytes — one constant to change if we want it.
 *
 * The real wins are elsewhere and need no argument: a phone photograph at
 * 4000px loses three quarters of its pixels here, and a PNG screenshot
 * becomes a fraction of itself.
 */
export const MAX_IMAGE_EDGE = 2048;

/**
 * THE SECOND COPY, for the screen that is not a desktop.
 *
 * The stored image is capped at 2048px and read in a column about 850px wide,
 * so a 390px phone is handed roughly five times the pixels it can show — and
 * pays for them on the worse of the two connections. One narrow copy is the
 * whole fix: `srcset` offers both widths and the browser picks, with no
 * negotiation, no `Vary` header and no second format.
 *
 * 640 because it covers every phone at 1× and the common ones at 2× once the
 * column's gutters come off; 960 as the threshold because below it the full
 * copy is already close enough that a second object costs a request and saves
 * nothing worth having. Both are measured against the SOURCE, before the cap —
 * a 1000px upload has no second copy worth making.
 */
export const VARIANT_WIDTH = 640;
/** What a variant always IS — it is made by the one encoder above, never passed through. */
export const VARIANT_CONTENT_TYPE = 'image/webp';
const VARIANT_MIN_SOURCE_WIDTH = 960;

/** Roughly the width of a fingernail — enough for colour and shape, nothing more. */
const PLACEHOLDER_EDGE = 16;

/** Formats where re-encoding would lose something the reader wanted. */
const LEAVE_ALONE = new Set(['image/svg+xml']);

export interface OptimisedImage {
  /** The bytes to store and serve — the conversion, or the original when that was better. */
  buffer: Buffer;
  contentType: string;
  /** The size it ENDED at, which is the box the markup must reserve. Null when undecodable. */
  width: number | null;
  height: number | null;
  /** A tiny inline stand-in (`data:` URL) to show while the real bytes travel. */
  placeholder: string | null;
  /**
   * The narrow copy, for the readers on a phone — null whenever making one
   * would not be an improvement: a source that was never wide, a format we do
   * not re-encode at all, bytes that would not decode, or a copy that came out
   * no smaller than the one it exists to save.
   */
  variant: ImageVariant | null;
}

/** A second rendering of the same picture at a second width. */
export interface ImageVariant {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
}

/** Hand back exactly what we were given — the answer whenever we cannot do better. */
const untouched = (buffer: Buffer, contentType: string, width: number | null = null, height: number | null = null): OptimisedImage =>
  ({ buffer, contentType, width, height, placeholder: null, variant: null });

/**
 * The narrow copy, or null when it would not be an improvement.
 *
 * The comparison is against the copy we are ACTUALLY going to serve: a
 * "smaller" variant that is bigger than the full image is two objects and one
 * more request for a picture the reader could have had in one.
 */
async function narrowVariant(buffer: Buffer, sourceWidth: number, mainBytes: number): Promise<ImageVariant | null> {
  if (sourceWidth <= VARIANT_MIN_SOURCE_WIDTH) return null;
  try {
    const out = await sharp(buffer).rotate()
      .resize({ width: VARIANT_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (out.data.length >= mainBytes) return null;
    return { buffer: out.data, contentType: VARIANT_CONTENT_TYPE, width: out.info.width, height: out.info.height };
  } catch {
    // A variant is an optimisation, never a precondition: a publish must not
    // die because the second encode did.
    return null;
  }
}

export async function optimiseImage(buffer: Buffer, contentType: string): Promise<OptimisedImage> {
  if (LEAVE_ALONE.has(contentType)) return untouched(buffer, contentType);

  let meta: Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    // The door already vouched for the type; a decode failure here is not a
    // reason to fail someone's publish. Serve what they gave us.
    return untouched(buffer, contentType);
  }
  // An animated image re-encodes to its first frame, which is not the image.
  if ((meta.pages ?? 1) > 1) return untouched(buffer, contentType, meta.width ?? null, meta.height ?? null);

  const width = meta.width ?? null;
  const height = meta.height ?? null;
  if (!width || !height) return untouched(buffer, contentType, width, height);

  // `withoutEnlargement` is what keeps a small image its own size; the cap only
  // ever removes pixels nobody was going to see.
  const pipeline = sharp(buffer).rotate().resize({
    width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE,
    fit: 'inside', withoutEnlargement: true,
  });

  let converted: { data: Buffer; info: OutputInfo };
  try {
    // Lossless where the source was: a screenshot of text is destroyed by
    // quantisation in a way a photograph is not.
    const lossless = contentType === 'image/png';
    // 78 rather than 82: measured at twice the saving on a real photograph
    // (21% against 11%) for a difference nobody looking at a document sees.
    converted = await pipeline.clone().webp(lossless ? { lossless: true, effort: 4 } : { quality: 78, effort: 4 }).toBuffer({ resolveWithObject: true });
  } catch {
    return untouched(buffer, contentType, width, height);
  }

  // Bigger than what we were given is not an optimisation. Keep the original —
  // and keep its dimensions, which are the half that stops the page jumping.
  const smaller = converted.data.length < buffer.length;
  const outWidth = smaller ? converted.info.width : width;
  const outHeight = smaller ? converted.info.height : height;

  let placeholder: string | null = null;
  try {
    const tiny = await sharp(buffer).rotate()
      .resize({ width: PLACEHOLDER_EDGE, height: PLACEHOLDER_EDGE, fit: 'inside' })
      .webp({ quality: 40 }).toBuffer();
    placeholder = `data:image/webp;base64,${tiny.toString('base64')}`;
  } catch { /* a document without a blur is fine; one that failed to publish is not */ }

  const mainBuffer = smaller ? converted.data : buffer;
  return {
    buffer: mainBuffer,
    contentType: smaller ? 'image/webp' : contentType,
    width: outWidth,
    height: outHeight,
    placeholder,
    variant: await narrowVariant(buffer, width, mainBuffer.length),
  };
}
