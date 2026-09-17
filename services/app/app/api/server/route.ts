/**
 * GET /api/server — this deployment's own identity: the canonical origin, and
 * the other origins it answers at.
 *
 * Public, unauthenticated and cacheable, because a client must be able to read
 * it before it holds any credential and must never send one to get it. It
 * carries no secret: both values are already the addresses people type.
 *
 * THE ORIGIN IS THE CONFIGURED ONE, never derived from the request. A request
 * arriving on an alias is answered with the canonical origin exactly as one
 * arriving on the canonical name is — deriving it from the request would let
 * whichever hostname a client happened to use declare itself canonical, which
 * is the whole thing this document exists to settle.
 */
import { ALIAS_ORIGINS, PUBLIC_BASE_URL } from '@/lib/config';
import { normalizeOrigin, type ServerIdentityDocument } from '@artifactbin/contracts';

export async function GET(_request: Request): Promise<Response> {
  const origin = normalizeOrigin(PUBLIC_BASE_URL) ?? new URL(PUBLIC_BASE_URL).origin;
  const document: ServerIdentityDocument = { origin, aliases: ALIAS_ORIGINS.filter((alias) => alias !== origin) };
  return Response.json(document, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
