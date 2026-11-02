import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
import { json, readJson } from '@/lib/http';
/** Agents (bearer) and the app's dataset editor (browser session) read and set v3 permissions through one contract. */
export const GET = withAgentOrBrowserAuth(async (request, { actor, params }) =>
  runOperation('get_dataset_policy', request, actor, { id: params.id }),
);
export const PUT = withAgentOrBrowserAuth(async (request, { actor, params }) => {
  const body = await readJson(request);
  return body ? runOperation('set_dataset_policy', request, actor, { ...body, id: params.id }) : json({ error: 'invalid_json' }, 400);
});
