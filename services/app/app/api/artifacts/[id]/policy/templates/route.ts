import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
/** The three starting v3 policies built for this dataset (get_dataset_policy_templates), for agents and the app. */
export const GET = withAgentOrBrowserAuth(async (request, { actor, params }) => {
  const ownerColumn = new URL(request.url).searchParams.get('ownerColumn');
  return runOperation('get_dataset_policy_templates', request, actor, { id: params.id, ...(ownerColumn !== null ? { ownerColumn } : {}) });
});
