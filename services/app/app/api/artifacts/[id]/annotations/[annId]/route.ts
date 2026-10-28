/**
 * POST /api/artifacts/:id/annotations/:annId — the `annotate` OPERATION, the
 * ONE annotation mutation: `{ reply?, resolve?, reopen? }`; reply may
 * accompany one state transition. Answers the updated thread. Uniform 404 for
 * an unknown annotation or an unreachable artifact — indistinguishable on
 * purpose.
 *
 * PATCH is the `edit_comment` OPERATION: `{ body, expected_revision? }` rewrites the text of the comment
 * `annId` names (a thread's first comment or a reply) — its author's only, the same uniform 404 otherwise.
 *
 * DELETE erases a thread (root + replies) for an ACCOUNT-CLAIMED bearer with
 * governing rights, the same ACL as the browser door; an anonymous token is
 * refused with account_required.
 *
 * Creation is its own door (../annotations POST), because a new thread needs an
 * anchor and this address already names one. Only the ATTRIBUTION is decided
 * here — a cookie caller is the human, a bearer caller the agent it declares
 * itself to be.
 */
import { withTokenAuth } from '@/lib/accounts';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';
import { annotationAuthorForRequest } from '@/lib/annotations';
import { deleteAnnotationFor } from '@/lib/annotations';

export const POST = withTokenAuth(async (request: Request, { actor, params, clientHarness }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation(
    'annotate',
    request,
    actor,
    { ...body, id: params.id, annotation_id: params.annId },
    actor.credential !== 'bearer'
      ? { kind: 'human', label: null, transport: 'browser' }
      : annotationAuthorForRequest(request, clientHarness),
  );
});

export const PATCH = withTokenAuth(async (request: Request, { actor, params, clientHarness }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  // Who is editing, attributed as the reply door attributes.
  return runOperation('edit_comment', request, actor, { ...body, id: params.id, comment_id: params.annId },
    actor.credential !== 'bearer' ? { kind: 'human', label: null, transport: 'browser' } : annotationAuthorForRequest(request, clientHarness));
});

export const DELETE = withTokenAuth(async (_request: Request, { actor, params }) => {
  if (!actor.userId) return json({ error: 'account_required', hint: 'Run `afbin auth` and sign in with an account; an anonymous credential owns no comments to delete.' }, 403);
  const deleted = await deleteAnnotationFor(actor, params.id, params.annId);
  return deleted ? json({ ok: true }) : json({ error: 'not_found' }, 404);
});
