import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
import { json, readJson } from '@/lib/http';

export const POST = withTokenAuth(async (request: Request, { actor }) => {
  const input = await readJson(request);
  if (!input) return json({ error: 'invalid_json' }, 400);
  return runOperation('browser_session', request, actor, input);
});
