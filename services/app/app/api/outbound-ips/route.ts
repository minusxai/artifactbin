/**
 * GET /api/outbound-ips — the addresses this deployment's outbound traffic leaves from (`APP__OUTBOUND_IPS`):
 * resolver database connections, `caps.fetch`, web ingestion. A database that only accepts listed addresses
 * must allow these. `{ips: []}` when the deployment has not configured them.
 *
 * Public, unauthenticated and cacheable, like GET /api/server: an agent or owner needs it before configuring a
 * firewall, and it carries nothing secret (any server it connects to already sees the address).
 */
import { OUTBOUND_IPS } from '@/lib/platform';

export async function GET(_request: Request): Promise<Response> {
  return Response.json({ ips: OUTBOUND_IPS }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
