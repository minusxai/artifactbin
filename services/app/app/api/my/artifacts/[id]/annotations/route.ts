/**
 * The BROWSER's annotation door — the only place annotations are CREATED.
 * POST { path, edit_id, body }: `path` is the BODY path the frame reported
 * for the selected node, `edit_id` the head the page believed in (staleness
 * is resolved server-side; an uncarryable base answers 409 with head so the
 * live page retries with fresh coordinates). GET lists like the bearer twin.
 *
 * Either browser credential authorizes (account session or the agent-session
 * cookie); who may create is `annotationScope` — owner, editor or COMMENTER,
 * the role that may say something and change nothing. A stranger's cookie
 * sees the uniform 404, because the artifact read is scoped the same way.
 */
import { respondToAnnotationList } from '@/app/api/artifacts/[id]/annotations/route';
import { createAnnotationFor, type CreateAnnotationInput } from '@/lib/annotations';
import { browserActor } from '@/lib/auth';
import { json, readJson, unauthorized } from '@/lib/http';
import { ownerUsername } from '@/lib/users';
import { actorForArtifacts } from '@/lib/viewer';

/** The caller as an artifact scope, or the Response that refuses them. */
async function scopeFor(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  return actorForArtifacts(actor) ?? unauthorized(request);
}

/** Body → input; null = malformed. */
function parseCreateBody(body: Record<string, unknown>): CreateAnnotationInput | null {
  if (typeof body.path !== 'string' || !/^\d+(\.\d+)*$/.test(body.path)) return null;
  if (typeof body.edit_id !== 'string' || body.edit_id.length === 0) return null;
  if (typeof body.body !== 'string' || body.body.trim().length === 0) return null;
  return { bodyPath: body.path, baseEditId: body.edit_id, body: body.body };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const { id } = await ctx.params;
  return respondToAnnotationList(request, scoped, id);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const input = parseCreateBody(body);
  if (!input) return json({ error: 'invalid_annotation_body' }, 400);

  // The author label is a display SNAPSHOT (never joined at read): the
  // account's public handle, or null for an anonymous cookie owner — the UI
  // then falls back to the kind.
  const made = await createAnnotationFor(scoped, id, input, {
    kind: 'human', label: await ownerUsername(scoped.userId), transport: 'browser',
  });
  if (made instanceof Response) return made; // the anchor edit's named publish refusal
  if (!made) return json({ error: 'not_found' }, 404);
  if ('refused' in made) {
    if (made.refused === 'stale') return json({ error: 'stale', edit_id: made.head.editId, version: made.head.version }, 409);
    return json({ error: made.refused }, 400);
  }
  return json(made, 201);
}
