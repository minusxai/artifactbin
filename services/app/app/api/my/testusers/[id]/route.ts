import { browserActor } from '@/lib/auth';
import { json } from '@/lib/http';
import { runOperation } from '@/lib/operations/http';
import { ensureUserToken } from '@/lib/tokens';

/**
 * DELETE /api/my/testusers/:id — the browser's twin of `testuser_delete`.
 *
 * The erase itself is the operation's, so a person clicking "delete" and an
 * agent calling the API remove exactly the same things: every artifact that
 * person made, its datasets and their rows, its comments, likes and follows,
 * its tokens and its live sessions. Hard, and idempotent — a second delete is
 * a 404 rather than a refusal.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const userId = actor.viewer?.userId;
  if (!userId) return json({ error: 'sign_in_required' }, 401);
  const { id } = await ctx.params;
  return runOperation('testuser_delete', request, { tokenId: await ensureUserToken(userId), userId }, { id });
}
