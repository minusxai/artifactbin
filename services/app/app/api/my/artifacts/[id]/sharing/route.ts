/** Browser sharing uses edit access for named grants, link access and dataset writes.
 * Ownership is independent of the share list. Deletion/restoration retain their
 * owner-only routes. The domain transaction rechecks authorization under a lock.
 */
import { capabilityGuard, getArtifactFor, getSharingFor, updateSharingFor } from '@/lib/artifacts';
import { parseAccessValue, parseLinkRoleValue, parseShareEntries, parseVisibilityValue } from '@/lib/artifact-wire';
import type { SharingPatch } from '@artifactbin/contracts';
import { browserActor } from '@/lib/authentication';
import { shareTargetsRefusal, TEST_ACCOUNT_RESTRICTED } from '@/lib/accounts';
import { json, readJson } from '@/lib/http';
import { catalogOf } from '@/lib/datasets';


export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const state = await getSharingFor(actor, id);
  if (!state) return json({ error: 'not_found' }, 404);
  return json(state);
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  // browserActor also refuses a cross-site mutation: this is cookie-
  // authenticated, so a browser is by definition the caller.
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);

  // The SAME parsers every other door runs (lib/artifact-wire), never a copy:
  // a door with its own parsing accepts `access` on a document and answers 200
  // for a write the SQL then drops, where the others answer 400, and one error
  // code ends up with two different refusals.
  const current = await getArtifactFor(actor, id);
  if (!current) return json({ error: 'not_found' }, 404);
  // Sharing is how an artifact reaches a PERSON by address, so it is one of the
  // acts a guest is sent to sign in for; a test user shares only inside its own
  // sandbox, where the addresses it could name are its own (lib/capabilities).
  const refusal = await capabilityGuard(actor, 'share', id);
  if (refusal) return refusal;

  const patch: SharingPatch = {};
  const visibility = parseVisibilityValue(body.visibility, !!(current.user_id || current.group_id));
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
  const boxed = await shareTargetsRefusal(actor, shares);
  if (boxed) return json({ error: TEST_ACCOUNT_RESTRICTED, detail: boxed }, 403);
  if (shares) patch.shares = shares;

  const state = await updateSharingFor(actor, id, patch);
  if (!state) return json({ error: 'not_found' }, 404);
  return json(state);
}
