import { getArtifactFor } from '@/lib/artifacts';
import { browserActor } from '@/lib/authentication';
import { baseUrl, json } from '@/lib/http';
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
  const { id } = await ctx.params;
  const row = await getArtifactFor(actor, id);
  if (!row) return json({ error: 'not_found' }, 404);
  // Anonymous browser sessions have no account token for an agent to reuse.
  if (!actor.userId) return json({ error: 'sign_in_required' }, 409);
  const base = baseUrl(request);
  return json({ id: row.id, url: `${base}/a/${row.id}`, prompt: existingPaste(base, row.id, row.meta.template as string | null) }, 201);
}
