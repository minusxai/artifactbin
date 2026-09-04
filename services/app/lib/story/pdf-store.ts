/**
 * Where a PDF's BYTES live — the shape of lib/story/image-store, with the one
 * difference that matters: a PDF is READ AS A STREAM.
 *
 * An image is small, is read on every render of every document that shows it,
 * and belongs in the store's read cache. A PDF is neither: it is up to 25 MB,
 * it is read when a person opens it, and a whole read of one would both cost
 * its own size in memory for the life of the response and evict essentially
 * the entire 32 MB cache the datasets, ref images and webfonts depend on (both
 * measured in the spike, S4). So the bytes go in with `put` and come out with
 * `getStream`, and this module is the only place that knows it.
 *
 * Nothing is re-encoded. The image door exists partly to make an upload fit to
 * read (WebP, a size cap, a blur); a PDF is a document its author laid out, and
 * the only honest thing to do with the bytes is keep them.
 */
import type { Readable } from 'node:stream';
import { objectKey, objectStore, type ByteRange } from '@/lib/object-store';

/** The content type this tier stores, and the only one it will accept. */
export const PDF_CONTENT_TYPE = 'application/pdf';

/** Where a PDF's bytes are, plus what to stamp into `meta`. */
export interface PdfLocation {
  objectKey: string;
  bytes: number;
}

/** Persist PDF bytes. Content-addressed: the same paper twice costs one object. */
export async function storePdf(buffer: Buffer): Promise<PdfLocation> {
  const key = objectKey('pdf', buffer);
  await objectStore().put(key, buffer, PDF_CONTENT_TYPE);
  return { objectKey: key, bytes: buffer.length };
}

/** What a stored PDF row keeps in `meta` — the shape every reader of one relies on. */
export interface PdfMeta {
  objectKey: string;
  bytes: number;
  contentType: string;
  /** Absent when the file does not say it in the clear — see {@link pdfPageCount}. */
  pages?: number;
}

/** A row's PDF meta, or null when the row is not a stored PDF (a shape a legacy row could take). */
export function pdfMetaOf(row: { meta: unknown }): PdfMeta | null {
  const meta = row.meta as { objectKey?: unknown; bytes?: unknown; pages?: unknown; contentType?: unknown } | null;
  if (typeof meta?.objectKey !== 'string' || !meta.objectKey) return null;
  return {
    objectKey: meta.objectKey,
    bytes: typeof meta.bytes === 'number' ? meta.bytes : 0,
    contentType: typeof meta.contentType === 'string' ? meta.contentType : PDF_CONTENT_TYPE,
    ...(typeof meta.pages === 'number' ? { pages: meta.pages } : {}),
  };
}

/**
 * The bytes, as a stream, optionally one inclusive range of them (a viewer
 * seeking inside a long document asks for exactly that). Raises
 * ObjectUnavailable when the store will not answer, like every other read whose
 * key came from a row: the DB is the only index, so a row promising bytes the
 * store will not give is corruption, never an empty file.
 */
export function loadPdfStream(meta: PdfMeta, range?: ByteRange): Promise<Readable> {
  return objectStore().getStream(meta.objectKey, range);
}

/**
 * The most pages this will count before it gives up and says nothing. A card
 * shows a number a person reads; past a few thousand pages the number stops
 * being information, and the ceiling is what makes the scan below bounded
 * whatever bytes arrive.
 */
const MAX_COUNTED_PAGES = 10_000;

/** `/Page` as bytes, and the whitespace a PDF may put before it. */
const TYPE = Buffer.from('/Type', 'latin1');
const PAGE = Buffer.from('/Page', 'latin1');
const isSpace = (b: number): boolean => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x00 || b === 0x0c;
const isLetter = (b: number): boolean => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);

/**
 * How many pages, WHEN THE FILE SAYS SO CHEAPLY — a scan for literal page
 * objects, no parser, no dependency, no decompression.
 *
 * `/Type /Pages` is the page TREE and `/Type /Page` is a leaf, so the count is
 * of leaves and the guard against the plural is load-bearing. Most modern PDFs
 * keep their objects inside a compressed object stream, where a scan of the raw
 * bytes finds nothing at all — and the honest answer there is NO ANSWER: the
 * card simply does not offer a page count. A guessed number in a document
 * someone hands to a colleague is worse than a missing one, and the alternative
 * (a real PDF parser on the publish path, for a line of caption text) buys a
 * dependency and a decompression bomb.
 *
 * BOUNDED IN BOTH DIRECTIONS, because this runs on the publish path in the one
 * event loop and its input is a 25 MB file a stranger chose. It walks the
 * BUFFER — no `toString`, so the 25 MB never becomes a 25 MB string — and stops
 * at MAX_COUNTED_PAGES, answering nothing rather than a number it stopped
 * counting. Measured on the worst case the cap and the sniff both admit (25 MB
 * of nothing but the token, 2,083,333 of them): the first implementation,
 * `toString('latin1')` then `match(/…/g)`, cost 109 ms and +87 MB RSS here and
 * 1.5 s / +210 MB in review, because `match` materialises every hit as a
 * string; this one costs under a millisecond and allocates nothing, because it
 * gives up after ten thousand.
 */
export function pdfPageCount(buffer: Buffer): number | undefined {
  let pages = 0;
  let at = 0;
  for (;;) {
    const hit = buffer.indexOf(TYPE, at);
    if (hit === -1) break;
    at = hit + TYPE.length;
    let p = at;
    while (p < buffer.length && isSpace(buffer[p])) p += 1;
    // No room left for the name: `buffer.compare` THROWS on an out-of-range
    // target, and this runs on the publish path, so a file whose last `/Type`
    // sits within a few bytes of the end would have been a 500 on create. Every
    // later hit is nearer the end still, so there is nothing left to find.
    if (p + PAGE.length > buffer.length) break;
    if (buffer.compare(PAGE, 0, PAGE.length, p, p + PAGE.length) !== 0) continue;
    const after = buffer[p + PAGE.length];
    if (after !== undefined && isLetter(after)) continue; // `/Pages`: the tree, not a leaf
    pages += 1;
    // A file with more pages than anyone reads off a card is one this refuses
    // to keep counting — that is what keeps the scan bounded.
    if (pages > MAX_COUNTED_PAGES) return undefined;
  }
  return pages > 0 ? pages : undefined;
}


/**
 * What the browser should call the file — `Content-Disposition`'s `filename`,
 * built from the document's title.
 *
 * The title is AUTHOR INPUT and this header is a quoted string, so a quote or a
 * newline in it would end the value early and let the rest be read as more
 * header. Everything outside a conservative printable-ASCII set is dropped
 * rather than escaped: the alternative (RFC 5987's `filename*`) buys accented
 * characters in a download name at the cost of a second encoding to get wrong,
 * and the id is a perfectly good name for the file that has none.
 */
export function pdfFilename(title: string | null | undefined, id: string): string {
  const safe = (title ?? '')
    // Quote, backslash and semicolon are this header's SYNTAX: they go.
    .replace(/["\\;]/g, '')
    // Anything else outside printable ASCII becomes a space rather than
    // vanishing — a dropped newline would otherwise weld two words together.
    .replace(/[^\x20-\x7e]/g, ' ')          // eslint-disable-line no-control-regex -- printable ASCII only
    .replace(/\s+/g, ' ')
    .trim();
  return `${safe || id}.pdf`;
}
