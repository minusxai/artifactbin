/**
 * POST /api/artifacts/:id/edits — one edit against a claimed base version
 * (concurrent-artifacts-edits.md); the `edit_artifact` OPERATION. Body is
 * exactly one of:
 *   { edit_id, old_string, new_string }   — agent diff (Edit-tool shape)
 *   { edit_id, source }                   — editor whole-doc (splice derived server-side)
 *
 * Answers: 200 full wire row (fresh edit_id inside) · 409 doc_changed /
 * stale_edit_id with { edit_id, source, version } of head so the caller can
 * rebase · 400 bad_diff { detail } · 400 not_editable (non-markup tier) ·
 * publish-pipeline 400s pass through (invalid_jsx etc.) · uniform 404.
 * The protocol lives in lib/artifact-wire (respondToEdit), shared with the
 * session-authed twin under /api/my.
 */
import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';

export const POST = withTokenAuth(async (request: Request, { tokenId, userId, params }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation('edit_artifact', request, { tokenId, userId }, { ...body, id: params.id });
});
