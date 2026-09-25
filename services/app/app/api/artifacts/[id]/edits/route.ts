/** Client-prepared JSONB operations. The shared authoring compiler validates
 * candidates; the commit owns permission, dependency and history atomicity. */
import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';

export const POST = withTokenAuth(async (request: Request, { tokenId, userId, params }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  return runOperation('edit_artifact', request, { tokenId, userId }, { ...body, id: params.id });
});
