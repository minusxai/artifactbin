import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations/http';

/** GET /api/artifacts/:id/versions — archived versions, newest first, no content. */
export const GET = withTokenAuth((request: Request, { actor, params }) =>
  runOperation('list_versions', request, actor, { ...Object.fromEntries(new URL(request.url).searchParams), id: params.id }));
