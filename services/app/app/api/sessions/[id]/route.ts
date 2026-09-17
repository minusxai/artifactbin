import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';

/**
 * GET /api/sessions/:id — `get_remote_session`, the read-only resource view.
 * DELETE /api/sessions/:id — `terminate_remote_session`, which honours an
 * Idempotency-Key so a lost reply is recovered rather than retried blindly.
 */
export const GET = withTokenAuth(async (request: Request, { tokenId, userId, params }) =>
  runOperation('get_remote_session', request, { tokenId, userId }, { id: params.id }));

export const DELETE = withTokenAuth(async (request: Request, { tokenId, userId, params }) =>
  runOperation('terminate_remote_session', request, { tokenId, userId }, { id: params.id }));
