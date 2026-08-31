import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';

/**
 * POST /api/artifacts/:id/mutate { sql, values? } → { id, version, affected, rowCount }
 * — the `mutate_dataset` OPERATION: the owner's write door for one
 * INSERT/UPDATE/DELETE against a dataset they own (lib/artifact-wire
 * respondToMutate holds the semantics and the refusals).
 */
export const POST = withTokenAuth(async (request: Request, { tokenId, userId, params }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation('mutate_dataset', request, { tokenId, userId }, { ...body, id: params.id });
});
