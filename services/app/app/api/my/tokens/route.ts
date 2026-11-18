/**
 * GET /api/my/tokens — the account's live tokens, for the tokens panel. A
 * browser credential (an account session, or the agent cookie on a claimed
 * token) is required; the agent cookie alone is an ANONYMOUS owner whose
 * tokens are not the account's list, so this is session-only. A run sign-in (contracts `RUN_SIGN_IN_PATH`) is listed
 * with the service it was issued to (`issued_by`), and reads `expired` once the credential it came from has ended. A
 * group's sign-in this account authorised is listed with the group and level it acts as (`group`), and reads `expired`
 * once that authorisation no longer holds (contracts identity-service `GROUP_SIGN_IN_RULE`).
 */
import { json, unauthorized } from '@/lib/http';
import { listTokensByUser, tokenStatus } from '@/lib/accounts';
import { sessionActor } from '@/lib/authentication';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  if (actor.credential !== 'session' || !actor.userId) return unauthorized(request);
  const tokens = (await listTokensByUser(actor.userId)).map(({ issued_by, live, group_id, group_name, group_role, ...token }) => {
    const status = tokenStatus(token);
    // A group's sign-in this account authorised: the group and level it acts as (its `issued_by` is this account).
    const group = group_id && group_role ? { group: { id: group_id, name: group_name ?? group_id, role: group_role } } : null;
    return { ...token, ...(group ?? (issued_by ? { issued_by } : {})), status: (issued_by || group) && status === 'active' && !live ? 'expired' as const : status };
  });
  return json({ tokens });
}
