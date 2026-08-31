import { canReadArtifact, getArtifactById, runDocumentMutation } from '@/lib/artifacts';
import { refusesCrossSite } from '@/lib/auth';
import { json, readJson } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { parseMutationRequest } from '@/lib/story/mutation-request';
import { sessionActor } from '@/lib/viewer';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

/**
 * POST /a/<id>/mutate { mutation, values? } → { ok, dataset, version, affected, rowCount }
 *
 * The DOCUMENT's write door — the sibling of ./query, and everything about it
 * is a narrowing of that route rather than a new kind of surface.
 *
 * WHAT THE CALLER SUPPLIES is a mutation NAME and scalar values. The SQL is
 * the one stored in the document, the dataset is the one that SQL names, and
 * the write is performed as the DOCUMENT's owner (lib/artifacts writerFor) —
 * so a reader can perform exactly the writes the author published, and
 * nothing else. There is no path here from caller text to SQL.
 *
 * WHO MAY CALL IT is whoever may READ the document, resolved by the same
 * viewer as the page, ./raw and ./query (`sessionActor`: NextAuth, then the
 * agent cookie). A served document is sandboxed without `allow-same-origin`,
 * so its own POST carries no cookie and is anonymous by construction — which
 * is what makes the CORS `*` safe here as it is there: this can only ever do
 * what an unauthenticated caller could. A PRIVATE document's readers get the
 * app shell instead (proxy.ts declaresLiveData), and the page relays with its
 * session — the one way a private document's writes happen at all.
 *
 * TWO GUARDS THE READ PATH DOES NOT NEED: a cookie-authenticated call must be
 * same-site (a cross-site POST riding the session is CSRF — a bearer/anonymous
 * caller sends no Origin and is never blocked). The per-visitor write budget
 * this route used to spend is the PROXY's MUTATE door now, counted before the
 * request is forwarded (P2 §H) — never here, where a second count in the same
 * process would halve the configured ceiling.
 *
 * The ACL is re-checked here on every call — never trusted from publish time:
 * `access` can be turned off after a document was published, and the answer
 * must change the moment it is.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404, CORS);
  const artifact = await getArtifactById(id);
  if (!artifact) return json({ error: 'not_found' }, 404, CORS);

  const actor = await sessionActor(request);
  /*
   * A COOKIE-authorized write must come from our own site.
   *
   * The condition is "does this caller hold ANY browser credential", not
   * "does it have a token id": `sessionActor` answers an account session with
   * `{viewer, tokenId: null}` and the agent cookie with `{tokenId}`, so a
   * guard written against `tokenId` alone protects the anonymous browser and
   * waves the LOGGED-IN one through — the wrong way round, and invisible
   * because both credentials look alike from here.
   *
   * It stays CONDITIONAL rather than unconditional because the served document
   * is sandboxed without `allow-same-origin`: its own legitimate POST carries
   * `Sec-Fetch-Site: cross-site` and no cookie at all, and refusing that would
   * break every public poll. A bearer agent sends no Origin and is likewise
   * never blocked.
   */
  if (refusesCrossSite(request, actor)) {
    return json({ error: 'forbidden' }, 403, CORS);
  }
  if (!(await canReadArtifact(artifact, actor.viewer))) return json({ error: 'not_found' }, 404, CORS);

  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400, CORS);
  const parsed = parseMutationRequest(body);
  if (parsed instanceof Response) return parsed;

  const result = await runDocumentMutation(artifact, parsed.mutation, parsed.values ?? {});
  if (!result.ok) {
    switch (result.reason) {
      case 'unknown_mutation':
        return json({ error: 'unknown_mutation', detail: `this document declares no <Mutation name="${parsed.mutation}">` }, 400, CORS);
      case 'dataset_full':
        return json({ error: 'dataset_full', detail: result.detail }, 409, CORS);
      case 'contended':
        // Not the caller's fault and not permanent: say so, and say when.
        return json({ error: 'dataset_busy', detail: result.detail }, 503, { ...CORS, 'Retry-After': '1' });
      case 'invalid_sql':
        return json({ error: 'mutation_failed', detail: result.detail }, 400, CORS);
      default:
        // read-only, or a target that is not (any longer) a writable dataset.
        return json({ error: 'dataset_read_only', detail: 'this dataset is not open for writes' }, 403, CORS);
    }
  }
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
