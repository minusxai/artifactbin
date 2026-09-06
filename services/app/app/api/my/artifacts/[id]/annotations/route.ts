import { notifyRemoteComment } from '@/lib/remote/mentions';
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
import { parseAnnotationRange } from '@/lib/story/annotation-range';
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

/**
 * Body → input, or the named refusal. `quote` and `range` are OPTIONAL and
 * independent: a caret comment carries neither, a quote may travel without a
 * range, and a range that is not the grammar is its own refusal (`bad_range`)
 * rather than a generic malformed body — the caller can only fix what it is told.
 */
type CreateBodyResult = { input: CreateAnnotationInput } | { error: 'invalid_annotation_body' | 'bad_range' };

function parseCreateBody(body: Record<string, unknown>): CreateBodyResult {
  const invalid = { error: 'invalid_annotation_body' } as const;
  const hasNode = typeof body.node_id === 'string' && body.node_id.length > 0;
  const hasLegacy = typeof body.path === 'string' && /^\d+(\.\d+)*$/.test(body.path)
    && typeof body.edit_id === 'string' && body.edit_id.length > 0;
  if (!hasNode && !hasLegacy) return invalid;
  if (typeof body.body !== 'string' || body.body.trim().length === 0) return invalid;
  if (body.quote !== undefined && typeof body.quote !== 'string') return invalid;
  const input: CreateAnnotationInput = { body: body.body };
  if (hasNode) input.nodeId = body.node_id as string;
  else { input.bodyPath = body.path as string; input.baseEditId = body.edit_id as string; }
  if (typeof body.quote === 'string') input.quote = body.quote;
  if (body.range !== undefined && body.range !== null) {
    const range = parseAnnotationRange(body.range);
    if (!range) return { error: 'bad_range' };
    input.range = range;
  }
  return { input };
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
  const parsed = parseCreateBody(body);
  if ('error' in parsed) return json({ error: parsed.error }, 400);

  // The author label is a display SNAPSHOT (never joined at read): the
  // account's public handle, or null for an anonymous cookie owner — the UI
  // then falls back to the kind.
  const made = await createAnnotationFor(scoped, id, parsed.input, {
    kind: 'human', label: await ownerUsername(scoped.userId), transport: 'browser',
  });
  if (made instanceof Response) return made; // the anchor edit's named publish refusal
  if (!made) return json({ error: 'not_found' }, 404);
  if ('refused' in made) {
    if (made.refused === 'stale') return json({ error: 'stale', edit_id: made.head.editId, version: made.head.version }, 409);
    return json({ error: made.refused }, 400);
  }
  notifyRemoteComment(scoped.userId, id, made.id, made.thread[0]);
  return json(made, 201);
}
