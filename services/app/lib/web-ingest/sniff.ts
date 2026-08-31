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

/** Whether the bytes are a WOFF2 font — the only format the font ingester stores. */
export function isWoff2(buf: Buffer): boolean {
  return startsWith(buf, 'wOF2');
}
