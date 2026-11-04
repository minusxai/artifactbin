/**
 * GET /api/artifacts/:id/regions/:regionId?format=markdown|html — one live region at the saved head (read_region).
 * PUT /api/artifacts/:id/regions/:regionId {markdown|html, base_version} — an agent's write, merged with people's
 * unsaved typing and saved as a version (write_region; Idempotency-Key honoured). `_doc` is a doc's one rich region.
 * A bearer token or the browser's own session (lib/region-sessions agents.ts).
 */
import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
import { json, readJson } from '@/lib/http';

export const GET = withAgentOrBrowserAuth((request, { actor, params }) => {
  const format = new URL(request.url).searchParams.get('format');
  return runOperation('read_region', request, actor, { id: params.id, regionId: params.regionId, ...(format !== null ? { format } : {}) });
});

export const PUT = withAgentOrBrowserAuth(async (request, { actor, params }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  // The path names the page and the region; the body never overrides them.
  return runOperation('write_region', request, actor, { ...body, id: params.id, regionId: params.regionId });
});
