/**
 * URL → stored PDF content: the guarded fetcher composed with the SAME
 * storePdfContent the upload door runs, exactly as lib/web-ingest/image.ts
 * composes storeImageContent — so the cap, the sniff and the stored shape are
 * one implementation rather than two that agree today.
 */
import { MAX_PDF_BYTES } from '@/lib/config';
import { json } from '@/lib/http';
import { storePdfContent } from '@/lib/story/data-tiers';
import type { StoredContent } from '@/lib/story/input';
import { fetchWebResource } from './fetch';
import { WebIngestError } from './guard';

/**
 * Fetch and store one PDF. Refusals are ready-to-return Responses that NAME the
 * url and the reason: the caller is a publish door, and an agent can act on
 * "404" or "not a PDF" where it cannot act on silence.
 */
export async function ingestPdfFromUrl(url: string): Promise<StoredContent | Response> {
  let bytes: Buffer;
  let finalUrl: string;
  try {
    const got = await fetchWebResource(url, { maxBytes: MAX_PDF_BYTES, accept: 'application/pdf,*/*' });
    bytes = got.bytes;
    finalUrl = got.finalUrl;
  } catch (error) {
    if (error instanceof WebIngestError) {
      return json({ error: 'pdf_fetch_failed', code: error.code, details: [`${url}: ${error.message}`] }, 400);
    }
    throw error;
  }
  const stored = await storePdfContent(bytes);
  if (stored instanceof Response) {
    // The store's own refusal, re-labelled as what it is from out here: the
    // URL is what the caller can act on, and `invalid_pdf` on a fetch reads as
    // though they had sent the bytes.
    const body = await stored.clone().json().catch(() => ({})) as { error?: string; details?: string[] };
    if (body.error === 'invalid_pdf') {
      return json({
        error: 'pdf_fetch_failed', code: 'unsupported_type',
        details: [`${url}: the response is not a PDF — a dead link often serves an html error page`],
      }, 400);
    }
    return stored;
  }
  // Provenance: where the copy came from. The document references OUR copy — an
  // import is a snapshot, deliberately — but the origin stays answerable.
  return { ...stored, meta: { ...stored.meta, sourceUrl: finalUrl } };
}
