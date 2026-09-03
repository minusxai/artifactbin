/**
 * What happens to an image between "someone uploaded it" and "a reader waits
 * for it".
 *
 * Measured on production before this existed: one photograph in one document
 * was 1.04 MB — twenty times the whole gzipped page around it — served as a
 * BASELINE jpeg, so it painted top to bottom over several seconds, and with no
 * width or height in the markup, so the page jumped when it landed. Nothing
 * was wrong with the serving (4ms from the box); the file was simply what came
 * off someone's phone.
 *
 * The rules below are each a thing that can go wrong, and every one of them
 * has the same shape: never make it worse than what was uploaded.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { optimiseImage, MAX_IMAGE_EDGE, VARIANT_WIDTH } from '../optimise';

/** A photograph-ish JPEG: noisy enough that it does not compress to nothing. */
const photo = async (width: number, height: number): Promise<Buffer> => {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7919) % 256;
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
};

const png = async (width: number, height: number, alpha = true): Promise<Buffer> =>
  sharp({ create: { width, height, channels: alpha ? 4 : 3, background: { r: 200, g: 30, b: 40, alpha: alpha ? 0.5 : 1 } } })
    .png().toBuffer();

/** What a file actually IS, from its magic bytes — never from what we hoped. */
const sniff = (b: Buffer): string =>
  b.subarray(0, 4).toString('hex') === '52494646' && b.subarray(8, 12).toString('ascii') === 'WEBP' ? 'webp'
  : b.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpeg'
  : b.subarray(1, 4).toString('ascii') === 'PNG' ? 'png'
  : b.subarray(0, 3).toString('ascii') === 'GIF' ? 'gif'
  : 'other';

describe('optimiseImage', () => {
  it('converts a photograph to a much smaller webp', async () => {
    const source = await photo(1700, 1687);
    const out = await optimiseImage(source, 'image/jpeg');
    expect(sniff(out.buffer)).toBe('webp');
    expect(out.contentType).toBe('image/webp');
    expect(out.buffer.length).toBeLessThan(source.length);
  });

  it('reports the intrinsic size, which is what stops the page jumping', async () => {
    const out = await optimiseImage(await photo(800, 600), 'image/jpeg');
    expect([out.width, out.height]).toEqual([800, 600]);
  });

  it('caps the long edge, and reports the size it actually ENDED at', async () => {
    const out = await optimiseImage(await photo(MAX_IMAGE_EDGE + 800, 1000), 'image/jpeg');
    expect(out.width).toBe(MAX_IMAGE_EDGE);
    // Reporting the original size here would reserve the wrong box for it.
    expect(out.height).toBeLessThan(1000);
    expect(await sharp(out.buffer).metadata().then((m) => m.width)).toBe(MAX_IMAGE_EDGE);
  });

  it('never enlarges something small', async () => {
    const out = await optimiseImage(await photo(64, 48), 'image/jpeg');
    expect([out.width, out.height]).toEqual([64, 48]);
  });

  it('keeps transparency', async () => {
    const out = await optimiseImage(await png(300, 300, true), 'image/png');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it('carries a tiny inline placeholder, so there is something in the right shape at once', async () => {
    const out = await optimiseImage(await photo(1200, 900), 'image/jpeg');
    expect(out.placeholder).toMatch(/^data:image\/webp;base64,/);
    // Small enough to inline in the markup without becoming the problem.
    expect(out.placeholder!.length).toBeLessThan(2000);
  });

  /*
   * The floor under everything: an upload must never come out heavier than it
   * went in. A small, already-optimised PNG re-encodes to a LARGER webp, and
   * the honest answer there is to keep what we were given.
   */
  it('never returns more bytes than it was given, whatever it is given', async () => {
    const inputs: Array<[Buffer, string]> = [
      [await photo(1700, 1687), 'image/jpeg'],
      [await photo(64, 48), 'image/jpeg'],
      [await png(300, 300, true), 'image/png'],
      [await png(8, 8, false), 'image/png'],
      [await sharp({ create: { width: 40, height: 40, channels: 3, background: '#123456' } }).webp({ quality: 60 }).toBuffer(), 'image/webp'],
    ];
    for (const [source, type] of inputs) {
      const out = await optimiseImage(source, type);
      expect(out.buffer.length).toBeLessThanOrEqual(source.length);
    }
  });

  it('hands back the original itself when converting would not be smaller', async () => {
    // Already a small lossy webp: re-encoding it cannot win, so it is kept —
    // bytes AND type, because rewriting the type of untouched bytes is a lie.
    const source = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#123456' } })
      .webp({ quality: 55 }).toBuffer();
    const out = await optimiseImage(source, 'image/webp');
    expect(out.buffer).toEqual(source);
    expect(out.contentType).toBe('image/webp');
    // The dimensions are still worth having — they are what reserves the box.
    expect([out.width, out.height]).toEqual([40, 40]);
  });

  it('leaves SVG alone: it is text, it scales, and rasterising it is a loss', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const out = await optimiseImage(svg, 'image/svg+xml');
    expect(out.buffer).toEqual(svg);
    expect(out.contentType).toBe('image/svg+xml');
  });

  it('leaves an animated GIF alone rather than freezing it', async () => {
    const gif = await sharp({ create: { width: 8, height: 16, channels: 3, background: '#00f' }, animated: true })
      .gif().toBuffer();
    const animated = Buffer.from(gif);
    const out = await optimiseImage(animated, 'image/gif');
    expect(sniff(out.buffer)).toBe('gif');
    expect(out.variant).toBeNull(); // …and no second copy of it either
  });

  /*
   * THE SECOND COPY — the one a phone downloads instead of the desktop's.
   *
   * The full variant is capped at 2048px and lands in a column about 850px
   * wide, so a 390px phone is handed roughly five times the pixels it can
   * show. A 640-wide copy is the whole fix, and it is made HERE for the same
   * reason everything else here is: at publish, in the one door every upload
   * and every URL import already comes through, so the two cannot disagree.
   *
   * The threshold is about the SOURCE: below 960px the full copy is already
   * close enough to 640 that a second object buys a request and saves nothing.
   */
  it('stores a narrow copy beside a wide one', async () => {
    const out = await optimiseImage(await photo(1600, 1200), 'image/jpeg');
    expect(out.variant?.width).toBe(VARIANT_WIDTH);
    expect(out.variant?.contentType).toBe('image/webp');
    expect(await sharp(out.variant!.buffer).metadata().then((m) => m.width)).toBe(VARIANT_WIDTH);
    // Same aspect ratio: the markup reserves the box from the FULL copy's
    // dimensions, and a variant of another shape would make that a lie.
    expect(out.variant!.height).toBe(Math.round((VARIANT_WIDTH * out.height!) / out.width!));
  });

  it('makes none when the image was never wide enough to need one', async () => {
    expect((await optimiseImage(await photo(900, 600), 'image/jpeg')).variant).toBeNull();
    expect((await optimiseImage(await photo(64, 48), 'image/jpeg')).variant).toBeNull();
  });

  it('never makes one that is bigger than the copy it is meant to save', async () => {
    for (const [w, h] of [[1600, 1200], [3000, 1000], [1000, 4000]]) {
      const out = await optimiseImage(await photo(w, h), 'image/jpeg');
      if (out.variant) expect(out.variant.buffer.length).toBeLessThan(out.buffer.length);
    }
  });

  /*
   * The formats that come back UNTOUCHED have no variant by construction — a
   * second copy of bytes we deliberately did not re-encode would be the
   * re-encode we refused, at a second size.
   */
  it('makes none for the formats it does not re-encode at all', async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000"/></svg>`);
    expect((await optimiseImage(svg, 'image/svg+xml')).variant).toBeNull();
    expect((await optimiseImage(Buffer.from('ffd8ffnot-really-a-jpeg', 'utf8'), 'image/jpeg')).variant).toBeNull();
  });

  // A publish must not die on an image; the door already vouched for the type.
  it('hands back bytes it cannot decode instead of throwing', async () => {
    const junk = Buffer.from('ffd8ffnot-really-a-jpeg', 'utf8');
    const out = await optimiseImage(junk, 'image/jpeg');
    expect(out.buffer).toEqual(junk);
    expect(out.width).toBeNull();
  });
});
