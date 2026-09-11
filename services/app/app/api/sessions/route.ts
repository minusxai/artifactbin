import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';

/**
 * GET /api/sessions — the `list_remote_sessions` OPERATION: this account's
 * remote terminal sessions as typed resources. The relay's own
 * /api/remote/sessions keeps the mirror protocol shape the browser reads.
 */
export const GET = withTokenAuth(async (request: Request, { tokenId, userId }) =>
  runOperation('list_remote_sessions', request, { tokenId, userId }, {}));
