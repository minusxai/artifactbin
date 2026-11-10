import { withTokenAuth } from '@/lib/authentication';
import { EventFeedRefusal, parseEventFeedQuery, readEventsFor } from '@/lib/event-feed';
import { json } from '@/lib/http';
import { AGENT_SESSION_HEADER, agentSessionKey } from '@artifactbin/contracts';

/** Auth/query translation only; lib/event-feed owns filters, cursors, access and waits (CONTRACT §6). */
export const GET = withTokenAuth(async (request, { actor }) => {
  try {
    const page = await readEventsFor(actor, parseEventFeedQuery(new URL(request.url).searchParams), {
      signal: request.signal, session: agentSessionKey(request.headers.get(AGENT_SESSION_HEADER)),
    });
    return page ? json(page, 200, { 'Cache-Control': 'no-store' }) : json({ error: { code: 'not_found' } }, 404);
  } catch (error) {
    if (request.signal.aborted) return json({ error: { code: 'aborted' } }, 499);
    if (!(error instanceof EventFeedRefusal)) throw error;
    return json({ error: { code: error.code, ...(error.message !== error.code ? { message: error.message } : {}) } }, error.status,
      error.status === 429 ? { 'Retry-After': '1' } : {});
  }
}, { readOnly: true });
