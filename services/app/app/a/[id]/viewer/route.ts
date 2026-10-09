import { canReadArtifact, compiledForRow, dataflowForRow, getArtifactById, holdableImports, viewerIdentityFor, type ArtifactRow, type RoleActor } from '@/lib/artifacts';
import { ID_RE } from '@/lib/platform';
import { json } from '@/lib/http';
import { sessionActor } from '@/lib/accounts';
import { planOf } from '@/lib/compiled-page/plan';
import { anonymousAccessFacts } from '@/lib/story/prepared';
import type { ServedResults } from '@/lib/story-runtime/contract';
import { readUrlValues } from '@/lib/dataflow';
import { LocalStateInputError } from '@/lib/dataflow';
import { DatasetError } from '@/lib/datasets/errors';
import { REVALIDATE_ACTOR_HEADER } from '@artifactbin/contracts';
import type { ViewerOverlay } from '@/lib/story-runtime/contract';

/**
 * GET /a/<id>/viewer?<$values> → ViewerOverlay (docs/phase2-architecture.md §4.2, §6)
 *
 * WHAT ONLY THIS READER DECIDES, after paint: who they are, the answers of the
 * `viewer`-scope queries (lib/compiled-page/plan) at the page's `$` values, and
 * the imports they may hold. Everything shared is the guest snapshot's and is
 * never answered here; `page`-scope queries (`_tz`) are the page's own.
 *
 * THE QUERY DOOR'S ADMISSION, exactly (`POST /a/:id/query`): the same session
 * actor, the same read ACL and the uniform 404 for a document this reader may
 * not read, the same actor shape into the run, the same recheck after every
 * wait. The run is `dataflowForRow` with `only` the viewer-scope names; its
 * closure over dependencies may compute shared tables on the way, so the answer
 * is PICKED to exactly the viewer-scope names, never passed through.
 *
 * `no-store`: the answer names the reader.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const artifact = await getArtifactById(id);
  if (!artifact) return json({ error: 'not_found' }, 404);
  // The standalone `/raw` reader is sandboxed to an opaque origin. Its `Origin:
  // null` fetch is deliberately credential-blind, like GET /query: never let a
  // cookie or bearer turn this cross-origin door into a session read.
  const opaqueOrigin = request.headers.get('Origin') === 'null';
  const actor = opaqueOrigin ? { viewer: null, tokenId: null } : await sessionActor(request);
  if (!(await canReadArtifact(artifact, actor.viewer))) return json({ error: 'not_found' }, 404);

  // The query route's actor: the token id travels with the account (see app/a/[id]/query POST).
  const viewer: RoleActor = { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: actor.viewer?.email ?? null };
  const authorize = async () => {
    const current = await getArtifactById(id), currentActor = opaqueOrigin ? null : (await sessionActor(request)).viewer;
    if (!current || current.edit_id !== artifact.edit_id || !(await canReadArtifact(current, currentActor))) throw new DatasetError('Document is unavailable', 404);
  };
  const refused = () => json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store' });

  let overlay: ViewerOverlay;
  try {
    overlay = await overlayFor(artifact, viewer, new URL(request.url).search, authorize, request.signal);
    await authorize();
  } catch (error) {
    if (error instanceof LocalStateInputError) return json({ error: 'invalid_local_state', detail: error.message }, 400, { 'Cache-Control': 'no-store' });
    if (error instanceof DatasetError) return refused();
    throw error;
  }
  return json(overlay, 200, {
    'Cache-Control': 'no-store',
    ...(opaqueOrigin ? { 'Access-Control-Allow-Origin': '*' } : {}),
    [REVALIDATE_ACTOR_HEADER]: '1',
  });
}

const pick = <T>(from: Record<string, T> | undefined, names: ReadonlySet<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(from ?? {}).filter(([name]) => names.has(name)));

const EMPTY: ServedResults = { tables: {}, errors: {} };

async function overlayFor(artifact: ArtifactRow, viewer: RoleActor, search: string, authorize: () => Promise<void>, signal: AbortSignal): Promise<ViewerOverlay> {
  const flow = artifact.format === 'markup' ? await compiledForRow(artifact) : null;
  if (!flow) return { viewer: await viewerIdentityFor(artifact, viewer.userId), results: EMPTY, hold: [] };

  // The plan the guest snapshot is keyed by (lib/story/prepared/snapshots.server): the same facts, the same split.
  const plan = planOf(flow, await anonymousAccessFacts(artifact, flow));
  const names = plan.queries.filter((q) => q.scope === 'viewer').map((q) => q.name);
  const [identity, hold, results] = await Promise.all([
    viewerIdentityFor(artifact, viewer.userId),
    holdableImports(artifact, flow, viewer),
    // No viewer-scope query and no write check: nothing of this reader's to run.
    names.length || flow.mutations.length ? viewerResults(artifact, names, viewer, readUrlValues(search, flow), authorize, signal) : EMPTY,
  ]);
  return { viewer: identity, results, hold };
}

async function viewerResults(artifact: ArtifactRow, names: string[], viewer: RoleActor, values: ReturnType<typeof readUrlValues>, authorize: () => Promise<void>, signal: AbortSignal): Promise<ServedResults> {
  const ran = await dataflowForRow(artifact, { values, only: names, viewer, authorize, signal });
  const answered = new Set(names);
  const state = ran?.state;
  return {
    tables: pick(state?.tables, answered),
    errors: pick(state?.errors, answered),
    // The write checks are per reader, which is why the guest snapshot never carries them.
    ...(ran?.flow.mutations.length ? { mutationAccess: state?.mutationAccess ?? {} } : {}),
    ...(state?.userOptions ? { userOptions: state.userOptions, people: state.people ?? {} } : {}),
  };
}
