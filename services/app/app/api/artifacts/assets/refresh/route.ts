import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { readJson } from '@/lib/http';

/**
 * POST /api/artifacts/assets/refresh { url? | id? } — the `refresh_asset`
 * OPERATION: re-fetch what we hold for a URL, or for every external URL one
 * document names.
 *
 * A static segment beside `[id]`: the URL form has no artifact to hang off, and
 * the document form takes the id in the BODY so one address serves both — the
 * alternative was two doors for one verb.
 */
export const POST = withTokenAuth(async (request: Request, { tokenId, userId }) => {
  const body = await readJson(request);
  return runOperation('refresh_asset', request, { tokenId, userId }, body ?? {});
});
