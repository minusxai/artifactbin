/**
 * POST /api/artifacts/:id/regions/:regionId/updates — one client update (contract RegionUpdateRequest), validated
 * before it is stored or relayed: RegionUpdateReply, or a refusal (409 out_of_order, 413 too_large, 422).
 */
import { REGION_UPDATE_MAX_BYTES } from '@artifactbin/contracts';
import { json } from '@/lib/http';
import { answer, browserEditor, regionSessions } from '../../doors';

/** The JSON envelope of the largest update: base64 grows it by a third. */
const BODY_LIMIT = Math.ceil(REGION_UPDATE_MAX_BYTES / 3) * 4 + 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export async function POST(request: Request, ctx: { params: Promise<{ id: string; regionId: string }> }) {
  const actor = await browserEditor(request);
  if (actor instanceof Response) return actor;
  const { id, regionId } = await ctx.params;
  const text = await request.text();
  if (text.length > BODY_LIMIT) return json({ error: 'too_large' }, 413);
  let body: { clientId?: unknown; update?: unknown };
  try { body = JSON.parse(text) as typeof body; } catch { return json({ error: 'invalid_json' }, 400); }
  const { clientId, update } = body ?? {};
  if (!Number.isInteger(clientId) || typeof update !== 'string' || !BASE64.test(update)) return json({ error: 'invalid_update' }, 400);
  return answer(await regionSessions().update(actor, id, regionId, { clientId: clientId as number, update: new Uint8Array(Buffer.from(update, 'base64')) }));
}
