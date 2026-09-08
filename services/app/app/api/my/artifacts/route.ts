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
import { browserActor } from '@/lib/auth';
import { listOwnedArtifacts } from '@/lib/users';
import { artifactSummaryToWire } from '@/lib/artifact-wire';
import { actorForArtifacts } from '@/lib/viewer';
import { ensureUserToken } from '@/lib/tokens';
import { createArtifactFromRequest } from '@/app/api/artifacts/route';
import { baseUrl, json, unauthorized } from '@/lib/http';

export async function POST(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const userId = actor.viewer?.userId ?? null;
  // A session mints/reuses its own token to own the row; an anonymous browser
  // already presented one.
  const tokenId = userId ? await ensureUserToken(userId) : actor.tokenId!;
  return createArtifactFromRequest(request, { tokenId, userId });
}

export async function GET(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  // Account-wide for a session, token-scoped for an anonymous browser — the
  // same rule as every other `*For` call, with the dashboard's view counts.
  const rows = scoped.userId
    ? await listOwnedArtifacts('user_id', scoped.userId)
    : await listOwnedArtifacts('token_id', scoped.tokenId);
  const base = baseUrl(request);
  return json({ artifacts: rows.map((r) => artifactSummaryToWire(r, base)) });
}
