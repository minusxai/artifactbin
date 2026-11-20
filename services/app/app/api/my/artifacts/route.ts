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
import { defaultHtmlSystem } from '@/lib/html-systems';
import { withStarterDesignSystem } from '@/lib/workspace/artifact-starters';

/** With a server default design system (APP__DESIGN_SYSTEM_DIR), "New" documents start in it: the untouched doc
 * starter the browser sends is rewritten to name it. Without one, or for any other body, the request is unchanged. */
async function withServerDesignSystem(request: Request): Promise<Request> {
  const system = defaultHtmlSystem();
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!system || type !== 'application/json' || new URL(request.url).searchParams.has('format')) return request;
  const text = await request.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = undefined; }
  const next = body === undefined ? body : withStarterDesignSystem(body, system);
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request.url, { method: request.method, headers, body: next === body ? text : JSON.stringify(next) });
}

export async function POST(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  // A session mints/reuses its own token to own the row; an agent-cookie browser holds one.
  const creator = actor.userId ? { ...actor, tokenId: await ensureUserToken(actor.userId) } : await withAccountToken(actor);
  return creator ? createArtifactFromRequest(await withServerDesignSystem(request), creator) : unauthorized(request);
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
