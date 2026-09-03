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
 */
export function pdfPageCount(buffer: Buffer): number | undefined {
  // latin1 keeps one byte per character, so the offsets and the count are the
  // file's own and no multi-byte sequence can merge two tokens into one.
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
  return matches && matches.length > 0 ? matches.length : undefined;
}
