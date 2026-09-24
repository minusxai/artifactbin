/**
 * POST /api/my/domain/verify { hostname } — check the account's domain's DNS
 * and mark it verified (lib/custom-domains verifyDomain).
 *
 * 200 the verified domain; 422 { error: txt_missing | not_pointing |
 * caa_blocks } naming the first failing check; 409 taken when another account
 * already verified the name; 404 not_found for a hostname
 * that is not this account's; 403 disabled while the flag is off.
 */
import { auth } from '@/auth';
import { domainResolver, verifyDomain } from '@/lib/custom-domains';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';

const NO_STORE = { 'Cache-Control': 'no-store' };
const VERIFY_STATUS = { disabled: 403, not_found: 404, taken: 409, txt_missing: 422, not_pointing: 422, caa_blocks: 422 } as const;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized(request);
  if (isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403, NO_STORE);
  const body = await readJson(request);
  if (!body || typeof body.hostname !== 'string') return json({ error: 'not_found' }, 404, NO_STORE);
  const result = await verifyDomain(session.user.id, body.hostname, domainResolver());
  if ('error' in result) return json({ error: result.error }, VERIFY_STATUS[result.error], NO_STORE);
  return json(result, 200, NO_STORE);
}
