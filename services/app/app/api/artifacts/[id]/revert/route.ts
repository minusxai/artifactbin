import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
import { json, readJson } from '@/lib/http';

/**
 * POST /api/artifacts/:id/revert { version } — restore an archived version as
 * a NEW version (the current state is archived first, so reverts are undoable).
 */
export const POST = withTokenAuth(async (request: Request, { actor, params }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation('revert_artifact', request, actor, { ...body, id: params.id });
});
