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
import { artifactToWireWithAnnotations, replaceArtifactFromRequest } from '@/lib/artifact-wire';
import { getArtifactFor } from '@/lib/artifacts';
import {updateMetadataFromBody} from '@/lib/metadata-wire';
import { browserActor } from '@/lib/auth';
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
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
  const browser = await browserActor(request);
  const viewer = browser instanceof Response ? null : browser.viewer ?? null;
  const wire = await artifactToWireWithAnnotations(row, baseUrl(request));
  // The EDITOR loads through here, and it names a dataset in the data view —
  // "C1kWy2" names nothing to a person. artifactToWire has no viewer to check
  // access with, so the join happens where one exists: a ref the viewer may
  // not read keeps its id alone rather than leaking what it is called.
  const refs = (wire as { refs?: Array<{ id: string; kind: string }> }).refs;
  if (Array.isArray(refs)) {
    (wire as { refs?: unknown }).refs = await Promise.all(refs.map(async (ref) => {
      // DATASETS only. The data view is the one place a ref is named, and it
      // names datasets; an image-heavy document would otherwise pay a lookup
      // per picture on every editor load to answer a question nobody asks.
      if (ref.kind !== 'dataset') return ref;
      const target = await getArtifactById(ref.id);
      return target && (await canReadArtifact(target, viewer))
        ? { ...ref, title: target.title ?? null }
        : ref;
    }));
  }
  return json(wire);
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

/** Browser metadata shares the same state condition and validation as the CLI. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const { id } = await ctx.params;
  return updateMetadataFromBody(scoped,id,body,baseUrl(request));
}

/**
 * DELETE /api/my/artifacts/:id — put an artifact you own in the trash.
 *
 * A FOLDER TAKES ITS SUBTREE, in the one statement lib/trash runs, and there is
 * no refusal and no `?force` here: nothing is erased, so there is no decision to
 * confirm. The rows are listed and restorable, and stay so — lib/trash keeps no
 * retention and runs no sweep.
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
