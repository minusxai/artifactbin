/**
 * POST /api/artifacts/:id/annotations/:annId — the `annotate` OPERATION, the
 * ONE annotation mutation: `{ reply?, resolve?, reopen? }`; reply may
 * accompany one state transition. Answers the updated thread. Uniform 404 for
 * an unknown annotation or an unreachable artifact — indistinguishable on
 * purpose.
 *
 * There is deliberately no bearer CREATE: an annotation is made from the
 * owner's selection in the browser; the agent's side of the loop is read
 * (inlined on the artifact GET), reply, resolve. Only the ATTRIBUTION is
 * decided here — a cookie caller is the human, a bearer caller the agent it
 * declares itself to be.
 */
import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';
import { annotationAuthorForRequest } from '@/lib/annotation-author';

export const POST = withTokenAuth(async (request: Request, { tokenId, userId, params, credential, clientHarness }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation(
    'annotate',
    request,
    { tokenId, userId },
    { ...body, id: params.id, annotation_id: params.annId },
    credential !== 'bearer'
      ? { kind: 'human', label: null, transport: 'browser' }
      : annotationAuthorForRequest(request, clientHarness),
  );
});
