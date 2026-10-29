import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations/http';

/**
 * POST /api/artifacts/:id/restore — the `restore_artifact` OPERATION: take a
 * row back out of the trash.
 *
 * No body, so there is nothing to parse and nothing to refuse: the id is the
 * whole request. The browser's own door (/api/my/artifacts/:id/restore) is the
 * same call under the other credential.
 */
export const POST = withTokenAuth(async (request: Request, { actor, params }) =>
  runOperation('restore_artifact', request, actor, { id: params.id }));
