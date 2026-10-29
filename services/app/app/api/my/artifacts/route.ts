/**
 * The BROWSER's artifact list and create — "my stuff", for whichever browser
 * credential the caller holds: an account session, or the agent-session cookie
 * naming an anonymous token (lib/agent-session).
 *
 * Both land in the SAME scope machinery (`*For`, lib/artifacts): an account
 * reaches everything it owns, an anonymous token reaches what it created.
 * That is what lets the app's own UI stop holding a bearer secret and still
 * show an anonymous owner their document.
 */
import { browserActor } from '@/lib/authentication';
import { withAccountToken } from '@/lib/accounts';
import { listOwnedArtifacts } from '@/lib/workspace';
import { artifactSummaryToWire } from '@/lib/artifact-wire';
import { ensureUserToken } from '@/lib/accounts';
import { createArtifactFromRequest } from '@/app/api/artifacts/route';
import { baseUrl, json, unauthorized } from '@/lib/http';

export async function POST(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  // A session mints/reuses its own token to own the row; an agent-cookie browser holds one.
  const creator = actor.userId ? { ...actor, tokenId: await ensureUserToken(actor.userId) } : await withAccountToken(actor);
  return creator ? createArtifactFromRequest(request, creator) : unauthorized(request);
}

export async function GET(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  // Account-wide for a session, token-actor for an anonymous browser — the
  // same rule as every other `*For` call, with the dashboard's view counts.
  const rows = actor.userId
    ? await listOwnedArtifacts('user_id', actor.userId)
    : await listOwnedArtifacts('token_id', actor.tokenId ?? '');
  const base = baseUrl(request);
  return json({ artifacts: rows.map((r) => artifactSummaryToWire(r, base)) });
}
