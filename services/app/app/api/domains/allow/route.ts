/**
 * GET /api/domains/allow?domain=<host> — the certificate ASK CHECK the
 * custom-domain edge (Caddy's on-demand TLS) calls before it obtains or
 * renews a certificate.
 *
 * 200 when the name is a verified custom domain, 404 for anything else. No
 * auth, and nothing beyond that one bit: not who owns it, not whether it is
 * pending. It deliberately IGNORES FLAG__CUSTOM_DOMAINS — reading it would
 * let turning the flag off stop renewals and break live domains within 90 days.
 */
import { isServable } from '@/lib/custom-domains';

const answer = (status: 200 | 404) => new Response(status === 200 ? 'ok' : 'not found', {
  status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
});

export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain') ?? '';
  return answer(domain && (await isServable(domain)) ? 200 : 404);
}
