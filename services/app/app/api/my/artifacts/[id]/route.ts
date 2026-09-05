/**
 * The BROWSER's handle on one document. Either browser credential authorizes:
 * an account session, or the agent-session cookie naming an anonymous token
 * (lib/agent-session) — both through the one `*For` scope family: an account
 * reaches everything it owns, an anonymous token what it created.
 *
 * `browserActor` also refuses a cross-site mutation: these are cookie-
 * authenticated, so a browser is by definition the caller and Origin is
 * present and unforgeable.
 */
import { artifactToWire, artifactToWireWithAnnotations, parseAccessValue, parseParentField, replaceArtifactFromRequest } from '@/lib/artifact-wire';
import { getArtifactFor, setAccessFor, setParentFor, writerFor } from '@/lib/artifacts';
import { isParentRefusal, parentOf, resolveParent } from '@/lib/folders';
import { browserActor } from '@/lib/auth';
import { trashArtifactFor } from '@/lib/trash';
import { actorForArtifacts } from '@/lib/viewer';
import { baseUrl, json, readJson, unauthorized } from '@/lib/http';

/** The caller as an artifact scope, or the Response that refuses them. */
async function scopeFor(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  return actorForArtifacts(actor) ?? unauthorized(request);
}

/** GET /api/my/artifacts/:id — owner-scoped full read-back (for the editor). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const { id } = await ctx.params;
  const row = await getArtifactFor(scoped, id);
  if (!row) return json({ error: 'not_found' }, 404);
  return json(await artifactToWireWithAnnotations(row, baseUrl(request)));
}

/**
 * PUT /api/my/artifacts/:id — owner-scoped full replace (editor save). The
 * SAME pipeline the bearer route runs (lib/artifact-wire): only the credential
 * differs, so the validation, the version bump and the answer are identical.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const { id } = await ctx.params;
  return replaceArtifactFromRequest(request, scoped, id, baseUrl(request));
}

/**
 * PATCH /api/my/artifacts/:id — metadata-only changes: `{ parent_id }` and
 * `{ access }`. Deliberately NOT the PUT: neither filing a document under a
 * folder nor opening a dataset for writes should require resending content or
 * bump the version — they are policy about the artifact, not an edit of it.
 *
 * THE ROW IS RESOLVED FIRST, and that ordering is the point. `parent_id` is
 * checked against the caller's own folders, which is a DATABASE READ — so a
 * row this caller cannot reach must answer the uniform 404 before any of it
 * runs, or "your parent is invalid" tells a stranger the document exists. The
 * shape check (a string or null) may run early; the lookup may not.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  // Shape only: the retired `folder` field named, and `parent_id` typed.
  const parent = parseParentField(body);
  if (parent instanceof Response) return parent;
  const { id } = await ctx.params;
  const hasAccess = body.access !== undefined && body.access !== null;
  if (!hasAccess && parent === undefined) return json({ error: 'nothing_to_change' }, 400);

  const current = await getArtifactFor(scoped, id);
  if (!current) return json({ error: 'not_found' }, 404);

  let row = current;
  if (hasAccess) {
    const access = parseAccessValue(body.access, current.format);
    if (access instanceof Response) return access;
    if (access) {
      const accessed = await setAccessFor(scoped, id, access);
      if (!accessed) return json({ error: 'not_found' }, 404);
      row = accessed;
    }
  }
  if (parent !== undefined) {
    const placement = await resolveParent(writerFor(current), parent, { id: current.id, format: current.format });
    if (isParentRefusal(placement)) return json(placement, 400);
    const moved = await setParentFor(scoped, id, placement.ancestor_ids);
    if (!moved) return json({ error: 'not_found' }, 404);
    row = moved;
  }
  return json({ id: row.id, parent_id: parentOf(row), ancestor_ids: row.ancestor_ids, ...(row.format === 'dataset' ? { access: row.access } : {}) });
}

/**
 * DELETE /api/my/artifacts/:id — put an artifact you own in the trash.
 *
 * A FOLDER TAKES ITS SUBTREE, in the one statement lib/trash runs, and there
 * is no refusal and no `?force` here any more: `folder_not_empty` existed
 * because a delete was permanent and a folder full of documents was a decision
 * nobody should discover afterwards. A trash is not that decision — the rows
 * are listed, restorable, and gone only after the retention — so the refusal
 * asked someone to confirm something that is no longer being done.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const { id } = await ctx.params;
  if (!(await trashArtifactFor(scoped, id))) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
}

/**
 * POST /api/my/artifacts/:id/restore lives beside this one (restore/route.ts)
 * rather than as a verb in the body here: it is a distinct act on a row this
 * door can no longer even see, since every read in this file goes through the
 * trash gate.
 */
