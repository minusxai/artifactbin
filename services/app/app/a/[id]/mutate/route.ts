import { canReadArtifact, getArtifactById, runDocumentMutation } from '@/lib/artifacts';
import { refusesCrossSite } from '@/lib/auth';
import { json, readJson } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { parseMutationRequest } from '@/lib/story/mutation-request';
import { requestOrSessionActor } from '@/lib/viewer';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

/**
 * A reader supplies a declared mutation name and its arguments (lib/story/mutation-request); SQL comes from the
 * stored document. Dataset edit permission belongs to the requesting actor,
 * independently of the document's role. Check it on every write.
 * Cookie credentials require same-site requests; bearers do not carry CSRF.
 * Anonymous visitors may execute explicitly delegated declared mutations.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404, CORS);
  const artifact = await getArtifactById(id);
  if (!artifact) return json({ error: 'not_found' }, 404, CORS);

  const actor = await requestOrSessionActor(request);
  if (refusesCrossSite(request, actor)) {
    return json({ error: 'forbidden' }, 403, CORS);
  }
  if (!(await canReadArtifact(artifact, actor.viewer))) return json({ error: 'not_found' }, 404, CORS);

  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400, CORS);
  const parsed = parseMutationRequest(body);
  if (parsed instanceof Response) return parsed;

  const result = await runDocumentMutation(artifact, parsed, {userId:actor.viewer?.userId ?? null,tokenId:actor.tokenId,email:actor.viewer?.email});
  if (!result.ok) {
    switch (result.reason) {
      case 'unknown_mutation':
        return json({ error: 'unknown_mutation', detail: `this document declares no <Mutation name="${parsed.mutation}">` }, 400, CORS);
      case 'invalid_row':
        return json({ error: 'invalid_row', detail: result.detail }, 400, CORS);
      case 'row_changed':
      case 'row_not_unique':
        return json({ error: result.reason, detail: result.detail }, 409, CORS);
      case 'dataset_full':
        return json({ error: 'dataset_full', detail: result.detail }, 409, CORS);
      case 'contended':
        // Not the caller's fault and not permanent: say so, and say when.
        return json({ error: 'dataset_busy', detail: result.detail }, 503, { ...CORS, 'Retry-After': '1' });
      case 'policy_denied':
        // A KIND refused (a guest, or a test user outside its sandbox) answers
        // as ITSELF: the door's own status and its own top-level error, which
        // is what the like/follow/fork controls already navigate on.
        if (result.capability) return json(result.capability.body, result.capability.status, CORS);
        // Otherwise: same status, same `error`. `code` is the machine-readable
        // half, and today it has exactly one value: an anonymous reader pressed
        // a write that binds `$_me` (lib/story/sign-in-required).
        return json({error:'policy_denied',...(result.code?{code:result.code}:{}),detail:result.detail},403,CORS);
      case 'invalid_sql':
        return json({ error: 'mutation_failed', detail: result.detail }, 400, CORS);
      default:
        // read-only, or a target that is not (any longer) a writable dataset.
        return json({ error: 'dataset_read_only', detail: 'You need edit access to a writable dataset to make this change.' }, 403, CORS);
    }
  }
  if ('local' in result) return json({ok: true, dataset: '', local: result.local}, 200, CORS);
  return json(
    { ok: true, dataset: result.dataset.id, version: result.dataset.version, affected: result.affected, rowCount: result.rowCount },
    200,
    CORS,
  );
}

/**
 * The document's own preflight. Its POST is a simple request when it can be
 * (`text/plain`), but a page relaying on its behalf sends JSON, and an opaque
 * origin then preflights.
 */
export async function OPTIONS(_request: Request, _ctx: { params: Promise<{ id: string }> }) {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    },
  });
}
