/**
 * GET /api/health — can a user be served right now?
 *
 * Under `/api/` on purpose: the proxy has already forwarded and this process
 * has already answered, so the handler adds only the hop the app owns —
 * `lib/health` asks sql, browser and events for their own `/health`.
 *
 * BLIND ON THE WIRE: `{ok:true}` or `503 {ok:false}`, nothing else, ever.
 * Which service failed is the operator's business (one log line), not the
 * public's — service names are topology.
 */
import { stackHealth } from '@/lib/health';

export async function GET(_request: Request): Promise<Response> {
  const { ok, failing } = await stackHealth();
  if (!ok) console.error(`[health] upstream unhealthy: ${failing.join(', ')}`);
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
