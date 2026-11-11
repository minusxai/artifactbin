import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import { defaultConnectionSchema } from '@/lib/connections';
import { json, unauthorized } from '@/lib/http';
/** GET `?namespace=NS`: the default connection's tables and columns its account can read, for a signed-in person. */
export async function GET(request: Request) {
  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) return json({ error: 'forbidden' }, 403);
  if (!actor.userId) return unauthorized(request);
  const namespace = new URL(request.url).searchParams.get('namespace') ?? undefined;
  const reply = await defaultConnectionSchema(actor, namespace || undefined, request.signal);
  return json(reply.body, reply.status, { 'Cache-Control': 'no-store' });
}
