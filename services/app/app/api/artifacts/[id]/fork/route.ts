import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { readJson } from '@/lib/http';

/**
 * POST /api/artifacts/:id/fork { title?, visibility?, folder? } — the
 * `fork_artifact` OPERATION: copy anything this token can READ into a new
 * artifact of its own. A body is optional (an empty fork keeps everything),
 * so an absent/unparseable one is simply no overrides rather than a 400.
 *
 * The browser's own fork door (/api/my/artifacts/:id/fork) is untouched: same
 * `forkArtifact`, different credential.
 */
export const POST = withTokenAuth(async (request: Request, { tokenId, userId, params }) => {
  const body = await readJson(request);
  return runOperation('fork_artifact', request, { tokenId, userId }, { ...(body ?? {}), id: params.id });
});
