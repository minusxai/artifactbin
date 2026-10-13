/** Client-prepared JSONB operations. The shared authoring compiler validates
 * candidates; the commit owns permission, dependency and history atomicity. */
import { withTokenAuth } from '@/lib/accounts';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';

export const POST = withTokenAuth(async (request: Request, { actor, params }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation('edit_artifact', request, actor, { ...body, id: params.id });
});
