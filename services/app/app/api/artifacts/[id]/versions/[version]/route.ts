import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';

/** GET /api/artifacts/:id/versions/:version — one archived version with content (`markup` carries the source). */
export const GET = withTokenAuth((request: Request, { tokenId, userId, params }) =>
  runOperation('get_version', request, { tokenId, userId }, { id: params.id, version: Number(params.version) }));
