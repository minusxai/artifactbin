import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';

/** GET /api/artifacts/:id/versions — archived versions, newest first, no content. */
export const GET = withTokenAuth((request: Request, { tokenId, userId, params }) =>
  runOperation('list_versions', request, { tokenId, userId }, { id: params.id }));
