import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';

/** GET /api/artifacts/:id/versions/:version — one archived version with content (`markup` carries the source). */
export const GET = withTokenAuth((request: Request, { actor, params }) =>
  runOperation('get_version', request, actor, { id: params.id, version: Number(params.version) }));
