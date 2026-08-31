/**
 * GET /api/my/tokens — the account's live tokens, for the tokens panel. A
 * browser credential (an account session, or the agent cookie on a claimed
 * token) is required; the agent cookie alone is an ANONYMOUS owner whose
 * tokens are not the account's list, so this is session-only.
 */
import { json, unauthorized } from '@/lib/http';
import { listTokensByUser, tokenStatus } from '@/lib/tokens';
import { sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.viewer?.userId) return unauthorized(request);
  const tokens = (await listTokensByUser(actor.viewer.userId)).map((token) => ({
    ...token,
    status: tokenStatus(token),
  }));
  return json({ tokens });
}
