/**
 * The identity owner's draft-check seam (contracts CANONICAL_DRAFT_CHECK_PATH): the body a trusted relay sent
 * `DRAFT_CHECK_PATH`, already admitted by its service secret on the auth host, checked in the app's own browser
 * (lib/page-drafts checkDraft) and answered `{problems, truncated, image?}`; a draft the store refuses answers its own code
 * and message, a browser that could not look 503 `check_unavailable`. The owner forwards it as the anonymous actor, so
 * a request with no actor, or as anyone, is refused. Exact keys, as the owner checks.
 */
import { SERVICE_PAYLOAD_LIMIT, DRAFT_CHECK_KEYS, type Actor } from '@artifactbin/contracts';
import { BodyTooLargeError, readBody } from '@artifactbin/utils';
import { checkDraft, DraftRefusal } from '@/lib/page-drafts';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function draftCheckSeam(request: Request, caller: Actor | null): Promise<Response> {
  if (caller?.credential !== 'none') return reply({ error: 'forbidden' }, 403);
  let body: unknown;
  try { body = JSON.parse(await readBody(request, { limit: SERVICE_PAYLOAD_LIMIT, as: 'text' })); } catch (error) {
    return error instanceof BodyTooLargeError ? reply({ error: 'too_large', max: SERVICE_PAYLOAD_LIMIT }, 413) : reply({ error: 'bad_request' }, 400);
  }
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null;
  if (!keys || !keys.includes('html') || !keys.includes('files') || keys.some(k => !(DRAFT_CHECK_KEYS as readonly string[]).includes(k))) return reply({ error: 'bad_request' }, 400);
  try {
    const checked = await checkDraft(body);
    return checked.ok ? reply({ problems: checked.problems, truncated: checked.truncated, ...(checked.image ? { image: checked.image } : {}) }) : reply({ error: checked.error }, 503);
  } catch (error) {
    if (error instanceof DraftRefusal) return reply({ error: error.code, message: error.message }, 400);
    throw error;
  }
}
