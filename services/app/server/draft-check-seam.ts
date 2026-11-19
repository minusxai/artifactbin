/**
 * The identity owner's draft-check seam (contracts CANONICAL_DRAFT_CHECK_PATH): the body a trusted relay sent
 * `DRAFT_CHECK_PATH`, already admitted by its service secret on the auth host, checked in the app's own browser
 * (lib/page-drafts checkDraft) and answered `{problems, truncated, image?}`; a draft the store refuses answers its own code
 * and message, a browser that could not look 503 `check_unavailable`. The owner forwards it as the anonymous actor, so
 * a request with no actor, or as anyone, is refused. Exact keys, as the owner checks.
 */
import { SERVICE_PAYLOAD_LIMIT, type Actor } from '@artifactbin/contracts';
import { BodyTooLargeError, readBody } from '@artifactbin/utils';
import { draftCheckAnswer } from '@/lib/page-drafts';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function draftCheckSeam(request: Request, caller: Actor | null): Promise<Response> {
  if (caller?.credential !== 'none') return reply({ error: 'forbidden' }, 403);
  let body: unknown;
  try { body = JSON.parse(await readBody(request, { limit: SERVICE_PAYLOAD_LIMIT, as: 'text' })); } catch (error) {
    return error instanceof BodyTooLargeError ? reply({ error: 'too_large', max: SERVICE_PAYLOAD_LIMIT }, 413) : reply({ error: 'bad_request' }, 400);
  }
  const answer = await draftCheckAnswer(body);
  return reply(answer.body, answer.status);
}
