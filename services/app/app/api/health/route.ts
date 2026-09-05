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
export async function GET(_request: Request): Promise<Response> {
  throw new Error('api-health: implement GET /api/health');
}
