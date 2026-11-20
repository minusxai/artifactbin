/**
 * The identity owner's chart seam (contracts CANONICAL_CHART_IMAGE_PATH): the body a trusted relay
 * sent `CHART_IMAGE_PATH`, already admitted by its service secret on the auth host, drawn by the
 * same renderer as `render_chart_image` and answered in its JSON shape. The owner forwards it as the
 * anonymous actor (no person is involved; the public reaches no internal path), so a request that
 * arrives with no actor at all, or as anyone, is refused. Exact keys, as the owner checks.
 */
import { SERVICE_PAYLOAD_LIMIT } from '@artifactbin/contracts/payload-limit';
import { CHART_IMAGE_KEYS } from '@artifactbin/contracts/identity-service';
import type { Actor } from '@artifactbin/contracts/actor';
import { BodyTooLargeError, readBody } from '@artifactbin/utils';
import { DESIGN_SYSTEM_VARIABLES } from '@/lib/html-systems/server';
import { chartImageAnswer } from '@/lib/viz';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function chartImageSeam(request: Request, caller: Actor | null): Promise<Response> {
  if (caller?.credential !== 'none') return reply({ error: 'forbidden' }, 403);
  let body: unknown;
  try { body = JSON.parse(await readBody(request, { limit: SERVICE_PAYLOAD_LIMIT, as: 'text' })); } catch (error) {
    return error instanceof BodyTooLargeError ? reply({ error: 'too_large', max: SERVICE_PAYLOAD_LIMIT, message: `the chart request is past the ${SERVICE_PAYLOAD_LIMIT}-byte limit`, hint: 'aggregate in SQL to fewer rows or columns' }, 413)
      : reply({ error: 'bad_request' }, 400);
  }
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null;
  if (!keys || !keys.includes('chart') || !keys.includes('rows') || keys.some(k => !(CHART_IMAGE_KEYS as readonly string[]).includes(k))) {
    return reply({ error: 'bad_request' }, 400);
  }
  const answer = await chartImageAnswer(body as Record<string, unknown>, DESIGN_SYSTEM_VARIABLES);
  return reply(answer.body, answer.status);
}
