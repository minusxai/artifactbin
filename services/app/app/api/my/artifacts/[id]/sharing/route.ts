/**
 * The ACL surface for one artifact — owner-only, and BROWSER-only (a bearer
 * agent sets visibility and access on create/PUT instead): sharing is a human
 * act. GET reads it; PUT updates the read ACL (visibility, the invited-email
 * list — full-replace, the dialog always sends the whole list) and, for a
 * dataset, the WRITE ACL (`access`).
 *
 * Either browser credential authorizes, through the OWNER scope (an editor
 * — artifact_shares.role — reaches the document but never its ACL), the same
 * `*For` family as every other /api/my route: an account session, or the agent-session
 * cookie naming an anonymous token. That widening is what `access` needs — a
 * write anchors on the creating token, not on an account, so an anonymous
 * owner must be able to open their own dataset for writes. `private` still
 * needs an account to anchor an ACL, and asking for it without one is the same
 * 400 the create door gives, never a silent downgrade.
 *
 * Uniform 404 for unknown/foreign ids, same as every other /api/my read.
 */
import { getOwnedArtifactFor, getSharingFor, updateSharingFor, type SharingPatch } from '@/lib/artifacts';
import { parseAccessValue, parseLinkRoleValue, parseShareEntries, parseVisibilityValue } from '@/lib/artifact-wire';
import { browserActor } from '@/lib/auth';
import { json, readJson, unauthorized } from '@/lib/http';
import { actorForArtifacts } from '@/lib/viewer';
import { catalogOf } from '@/lib/datasets/catalog';

/** The caller as an artifact scope, or the Response that refuses them. */
async function scopeFor(request: Request) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  return actorForArtifacts(actor) ?? unauthorized(request);
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const { id } = await ctx.params;
  const state = await getSharingFor(scoped, id);
  if (!state) return json({ error: 'not_found' }, 404);
  return json(state);
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  // browserActor also refuses a cross-site mutation: this is cookie-
  // authenticated, so a browser is by definition the caller.
  const scoped = await scopeFor(request);
  if (scoped instanceof Response) return scoped;
  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);

  // The SAME parsers every other door runs (lib/artifact-wire). Written out
  // separately here once, they had already drifted: this door accepted
  // `access` on a document and answered 200 for a write the SQL then dropped,
  // where the others answer 400 — and the two preview refusals read
  // differently for one error code.
  const current = await getOwnedArtifactFor(scoped, id);
  if (!current) return json({ error: 'not_found' }, 404);

  const patch: SharingPatch = {};
  const visibility = parseVisibilityValue(body.visibility, !!scoped.userId);
  if (visibility instanceof Response) return visibility;
  if (visibility) patch.visibility = visibility;

  // GENERAL ACCESS: the tier (visibility) and the role the link grants are
  // two independent controls in the dialog, and independent here too — an
  // owner may set either without restating the other.
  const linkRole = parseLinkRoleValue(body.linkRole);
  if (linkRole instanceof Response) return linkRole;
  if (linkRole) patch.linkRole = linkRole;

  const access = parseAccessValue(body.access, current.format);
  if (access instanceof Response) return access;
  // Refuse before updateSharingFor opens its transaction: a combined patch
  // must never apply visibility/shares and silently drop an impossible access.
  if (access === 'readwrite' && catalogOf(current)?.kind === 'postgres') {
    return json({ error: 'dataset_read_only', details: ['Postgres datasets are read-only'] }, 400);
  }
  if (access) patch.access = access;
  const shares = parseShareEntries(body.shares);
  if (shares instanceof Response) return shares;
  if (shares) patch.shares = shares;

  const state = await updateSharingFor(scoped, id, patch);
  if (!state) return json({ error: 'not_found' }, 404);
  return json(state);
}
