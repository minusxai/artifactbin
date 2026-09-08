import { getArtifactFor } from '@/lib/artifacts';
import { browserActor } from '@/lib/auth';
import { actorForArtifacts } from '@/lib/viewer';
import { baseUrl, json, unauthorized } from '@/lib/http';
import { existingPaste } from '@/lib/agent-copy';

/**
 * POST /api/my/artifacts/:id/agent-prompt — "hand this document to an agent".
 *
 * The document already exists, so the paste is its link alone. The agent uses
 * the account token it already holds; minting a new credential here would
 * create a token no response consumes.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id } = await ctx.params;
  const row = await getArtifactFor(scoped, id);
  if (!row) return json({ error: 'not_found' }, 404);
  // Anonymous browser sessions have no account token for an agent to reuse.
  if (!actor.viewer?.userId) return json({ error: 'sign_in_required' }, 409);
  const base = baseUrl(request);
  return json({ id: row.id, url: `${base}/a/${row.id}`, prompt: existingPaste(base, row.id) }, 201);
}
