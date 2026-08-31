/**
 * URL → stored image content: the guarded fetcher composed with the SAME
 * storeImageContent every upload path runs, so the size cap and the type
 * policy cannot fork from the file-picker's. The stored type comes from the
 * BYTES (sniff), never the remote header — a dead link's html error page must
 * refuse, not become an "image" that renders broken forever.
 */
import { MAX_IMAGE_BYTES } from '@/lib/config';
import { json } from '@/lib/http';
import { storeImageContent } from '@/lib/story/data-tiers';
import type { StoredContent } from '@/lib/story/input';
import { fetchWebResource } from './fetch';
import { WebIngestError } from './guard';
import { sniffImageType } from './sniff';

/**
 * Fetch and store one image. Refusals are ready-to-return Responses that NAME
 * the url and the reason — the caller is a publish door, and an agent can act
 * on "404" where it cannot act on silence.
 */
export async function ingestImageFromUrl(url: string): Promise<StoredContent | Response> {
  let bytes: Buffer;
  let finalUrl: string;
  try {
    const got = await fetchWebResource(url, { maxBytes: MAX_IMAGE_BYTES, accept: 'image/*' });
    bytes = got.bytes;
    finalUrl = got.finalUrl;
  } catch (error) {
    if (error instanceof WebIngestError) {
      return json({ error: 'image_fetch_failed', code: error.code, details: [`${url}: ${error.message}`] }, 400);
    }
    throw error;
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return json({
      error: 'image_fetch_failed', code: 'unsupported_type',
      details: [`${url}: the response is not an image (png|jpeg|webp|gif|svg) — a dead link often serves an html error page`],
    }, 400);
  }
  const stored = await storeImageContent(bytes, contentType);
  if (stored instanceof Response) return stored;
  // Provenance: where the copy came from. The document references OUR copy —
  // an import is a snapshot, deliberately — but the origin stays answerable.
  return { ...stored, meta: { ...stored.meta, sourceUrl: finalUrl } };
}
