/**
 * Byte sniffing for ingested resources — PURE. The remote Content-Type header
 * is attacker-controlled (a dead image link serves text/html that says 404,
 * a hostile host can label anything anything), so the stored type comes from
 * the BYTES, and bytes that match nothing are a refusal.
 */

const startsWith = (buf: Buffer, magic: number[] | string, at = 0): boolean => {
  const m = typeof magic === 'string' ? Buffer.from(magic, 'latin1') : Buffer.from(magic);
  return buf.length >= at + m.length && buf.subarray(at, at + m.length).equals(m);
};

/**
 * The svg check must see through what real files carry before `<svg` — BOM,
 * whitespace, an xml declaration, comments — while never matching svg nested
 * inside an html document (that is an error page, not an image).
 */
const isSvg = (buf: Buffer): boolean => {
  let text = buf.subarray(0, 1024).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Strip leading prolog noise only — anything else before <svg disqualifies.
  for (;;) {
    const before = text;
    text = text.replace(/^\s+/, '').replace(/^<\?xml[^>]*\?>/i, '').replace(/^<!--[\s\S]*?-->/, '').replace(/^<!DOCTYPE[^>]*>/i, '');
    if (text === before) break;
  }
  return /^<svg[\s>/]/i.test(text);
};

/** The image type the bytes actually are — one of IMAGE_CONTENT_TYPES, or null. */
export function sniffImageType(buf: Buffer): string | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, 'GIF87a') || startsWith(buf, 'GIF89a')) return 'image/gif';
  if (startsWith(buf, 'RIFF') && startsWith(buf, 'WEBP', 8)) return 'image/webp';
  if (isSvg(buf)) return 'image/svg+xml';
  return null;
}

/**
 * The type an ASSET the document embeds or links to actually is: an image, or
 * a PDF. Nothing else — a font is fetched by a different door with a different
 * cap, and a type this app does not serve is a refusal rather than a guess.
 *
 * `sniffImageType` is image-only BY CONSTRUCTION, which the PDF spike found the
 * hard way: it does not know `%PDF-`, so a PDF handed to the image door is
 * simply "not an image", and the tier that stores PDFs needs its own answer.
 * The signature must be at the very start — a PDF hidden inside an html error
 * page is an html error page.
 */
export function sniffAssetType(buf: Buffer): string | null {
  if (startsWith(buf, '%PDF-')) return 'application/pdf';
  return sniffImageType(buf);
}

/** Whether the bytes are a WOFF2 font — the only format the Google Fonts ingester stores. */
export function isWoff2(buf: Buffer): boolean {
  return startsWith(buf, 'wOF2');
}

/**
 * The font type the bytes actually are, for a face a document self-hosts by
 * URL (`@font-face { src: url(https://…) }`).
 *
 * Wider than {@link isWoff2} on purpose: the Google Fonts path asks css2 for
 * woff2 and gets it, but an author naming their own face names whatever their
 * host serves, and refusing a real TTF because it is not the format we would
 * have chosen would fail a publish for no reason a reader could see. Nothing
 * here is re-encoded, so the format is the author's to choose — the sniff only
 * has to be sure it IS a font, since the stored type is what `nosniff` then
 * holds the browser to.
 */
export function sniffFontType(buf: Buffer): string | null {
  if (startsWith(buf, 'wOF2')) return 'font/woff2';
  if (startsWith(buf, 'wOFF')) return 'font/woff';
  if (startsWith(buf, 'OTTO')) return 'font/otf';
  // TrueType: 0x00010000 (Windows/Adobe) or 'true'/'ttcf' (Apple, collections).
  if (startsWith(buf, [0x00, 0x01, 0x00, 0x00]) || startsWith(buf, 'true') || startsWith(buf, 'ttcf')) return 'font/ttf';
  return null;
}
