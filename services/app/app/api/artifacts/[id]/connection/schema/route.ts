import { withAgentOrBrowserAuth } from '@/lib/authentication';
import { json } from '@/lib/http';
import { liveSchema } from '@/lib/live-datasets';
/** GET: the tables and columns a live dataset's account reads (owner and editors; `sql.mjs schema ID`). */
export const GET = withAgentOrBrowserAuth(async (request, { actor, params }) => {
  const reply = await liveSchema(actor, params.id!, request.signal);
  return json(reply.body, reply.status, { 'Cache-Control': 'no-store' });
});
