import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json } from '@/lib/http';

export const POST = withTokenAuth(async (request: Request, { tokenId, userId }) => {
  let input: unknown;
  try { input = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'invalid_request' }, 400);
  return runOperation('browser_session', request, { tokenId, userId }, input as Record<string, unknown>);
});
