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
import { artifactToWire, artifactToWireWithAnnotations, parseAccessValue, parseFolderField, replaceArtifactFromRequest } from '@/lib/artifact-wire';
import { deleteArtifactFor, getArtifactFor, setAccessFor, setFolderFor } from '@/lib/artifacts';
import { browserActor } from '@/lib/auth';
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
 * PATCH /api/my/artifacts/:id — metadata-only changes: `{ folder }` and
 * `{ access }`. Deliberately NOT the PUT: neither a folder move nor opening a
 * dataset for writes should require resending content or bump the version —
 * they are policy about the artifact, not an edit of it.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const folder = parseFolderField(body);
  if (folder instanceof Response) return folder;
  const { id } = await ctx.params;

  // `access` needs the row's FORMAT to validate, so it is read first.
  let accessed: Awaited<ReturnType<typeof setAccessFor>> = null;
  if (body.access !== undefined && body.access !== null) {
    const current = await getArtifactFor(scoped, id);
    if (!current) return json({ error: 'not_found' }, 404);
    const access = parseAccessValue(body.access, current.format, request);
    if (access instanceof Response) return access;
    if (access) {
      accessed = await setAccessFor(scoped, id, access);
      if (!accessed) return json({ error: 'not_found' }, 404);
    }
  } else if (folder === undefined) {
    return json({ error: 'nothing_to_change' }, 400);
  }

  const row = folder !== undefined ? await setFolderFor(scoped, id, folder) : accessed;
  if (!row) return json({ error: 'not_found' }, 404);
  return json({ id: row.id, folder: row.folder, ...(row.format === 'dataset' ? { access: row.access } : {}) });
}

/** DELETE /api/my/artifacts/:id — delete an artifact you own. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const { id } = await ctx.params;
  const deleted = await deleteArtifactFor(scoped, id);
  if (!deleted) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
}
