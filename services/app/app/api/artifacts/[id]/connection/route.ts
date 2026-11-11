import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { json, readJson } from '@/lib/http';
import { liveConnectionDetails, updateLiveConnection } from '@/lib/live-datasets';
/**
 * A LIVE DATASET'S CONNECTION (lib/live-datasets). GET: its connector and shown fields, who its rules admit to declared
 * queries and the pages declaring them, for anyone who can read the dataset; an owner or editor also gets the
 * non-secret fields and the names of the secrets stored, never a value. PATCH (owner and editors): change it; an
 * omitted secret is kept only while every other field stays as stored.
 */
const NO_STORE = { 'Cache-Control': 'no-store' };
export const GET = withAgentOrBrowserAuth(async (_request, { actor, params }) => {
  const reply = await liveConnectionDetails(actor, params.id!);
  return json(reply.body, reply.status, NO_STORE);
});
export const PATCH = withAgentOrBrowserAuth(async (request, { actor, params }) => {
  const body = await readJson(request).catch(() => null);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const reply = await updateLiveConnection(actor, params.id!, (body as { connection?: unknown }).connection ?? body);
  return json(reply.body, reply.status, NO_STORE);
});
