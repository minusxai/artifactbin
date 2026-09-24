/**
 * GET/POST/DELETE /api/my/domain — the signed-in account's custom domain
 * (lib/custom-domains holds every rule; this translates them to HTTP).
 *
 * GET    → { enabled, target, targetAddresses, domain }: whether attaching is
 *          on, where to point DNS (the target and the addresses it resolves
 *          to, for an A record on a bare domain), and the domain, if any —
 *          shown even while the flag is off, so it can still be removed.
 * POST   { hostname } → 201 the pending domain with its two records;
 *          400 invalid_hostname, 409 taken / limit, 403 disabled.
 * DELETE → 204, whatever the flag says.
 */
import { auth } from '@/auth';
import { CUSTOM_DOMAINS_TARGET } from '@/lib/config';
import { attachDomain, domainOf, domainResolver, removeDomain } from '@/lib/custom-domains';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ATTACH_STATUS = { disabled: 403, invalid_hostname: 400, taken: 409, limit: 409 } as const;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  const target = CUSTOM_DOMAINS_TARGET;
  const [domain, targetAddresses] = await Promise.all([
    domainOf(session.user.id),
    target ? domainResolver().addresses(target).catch(() => []) : Promise.resolve([]),
  ]);
  return json({ enabled: !!target, target, targetAddresses, domain }, 200, NO_STORE);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  // Cookie-authenticated: a cross-site caller riding the session is CSRF.
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const body = await readJson(request);
  if (!body || typeof body.hostname !== 'string') return json({ error: 'invalid_hostname' }, 400, NO_STORE);
  const result = await attachDomain(session.user.id, body.hostname);
  if ('error' in result) return json({ error: result.error }, ATTACH_STATUS[result.error], NO_STORE);
  return json(result, 201, NO_STORE);
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403, NO_STORE);
  await removeDomain(session.user.id);
  return new Response(null, { status: 204, headers: NO_STORE });
}
