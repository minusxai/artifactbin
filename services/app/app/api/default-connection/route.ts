import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { defaultConnectionStatus } from '@/lib/connections';
import { json, unauthorized } from '@/lib/http';
/**
 * GET: whether this install has a default connection, its connector and shown fields (host, port, database), for a
 * signed-in person (lib/connections). Never the user or the secret.
 */
export async function GET(request: Request) {
  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  if (!actor.userId) return unauthorized(request);
  return json(defaultConnectionStatus(), 200, { 'Cache-Control': 'no-store' });
}
