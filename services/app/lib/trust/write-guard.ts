/**
 * THE ORIGIN RULE FOR EVERY TRUST WRITE (/api/trust and a group's addresses): a write that mints or changes a grant
 * comes from the app's own page or from a bearer client that sends no browser fetch metadata, never from another site
 * (a signed-out reader would otherwise be pre-consented by a cross-site form post that arrives cookie-less) and never
 * from a same-site document origin (a framed document's script must not consent on its reader's behalf). Writes are
 * JSON only, so a cross-origin caller cannot send one without a preflight.
 */
import { isCrossSiteRequest, json } from '@/lib/http';

/** A write from anywhere but the app's own page: another site, or a same-site sibling origin. */
function foreignWrite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false;
  const site = request.headers.get('sec-fetch-site');
  return site ? site !== 'same-origin' : isCrossSiteRequest(request);
}

/** The refusal for a trust write that breaks the rule above (403 foreign, 415 not JSON), or null. */
export function refusedTrustWrite(request: Request): Response | null {
  if (foreignWrite(request)) return json({ error: 'forbidden' }, 403);
  if (request.method !== 'GET' && request.method !== 'HEAD' && !(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json({ error: 'unsupported_media_type' }, 415);
  return null;
}
