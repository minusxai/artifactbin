import { browserActor } from '@/lib/auth';
import { json } from '@/lib/http';
import { runOperation } from '@/lib/operations/http';
import { ensureUserToken } from '@/lib/tokens';

/**
 * GET|POST /api/my/testusers — the BROWSER's door onto the same operations the
 * agent surface exposes at /api/testusers.
 *
 * Two doors over one operation, exactly as forking has: `/api/*` is the bearer
 * surface (every route there is a registry operation) and `/api/my/*` is the
 * one a session credential opens. Nothing about what a test user IS lives here;
 * this only turns a cookie into the account token the operation runs as.
 */
async function acting(request: Request): Promise<{ tokenId: string; userId: string } | Response> {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const userId = actor.viewer?.userId;
  // No account: the same code every control navigates to the login page on.
  if (!userId) return json({ error: 'sign_in_required' }, 401);
  return { tokenId: await ensureUserToken(userId), userId };
}

export async function POST(request: Request): Promise<Response> {
  const actor = await acting(request);
  return actor instanceof Response ? actor : runOperation('testuser_create', request, actor, {});
}

export async function GET(request: Request): Promise<Response> {
  const actor = await acting(request);
  return actor instanceof Response ? actor : runOperation('testuser_list', request, actor, {});
}
