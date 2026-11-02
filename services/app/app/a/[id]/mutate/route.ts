import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { refusesCrossSite } from '@/lib/authentication';
import { json, readJson } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { parseMutationRequest } from '@/lib/dataflow';
import { requestOrSessionActor } from '@/lib/authentication';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

/**
 * A reader supplies a declared mutation name and its arguments (lib/dataflow/mutation-request); SQL comes from the
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
  if (!(await canReadArtifact(artifact, actor))) return json({ error: 'not_found' }, 404, CORS);

  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400, CORS);
  const parsed = parseMutationRequest(body);
  if (parsed instanceof Response) return parsed;

  return json({error:'unknown_mutation'},400,CORS);
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
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
      'Access-Control-Max-Age': '600',
    },
  });
}
