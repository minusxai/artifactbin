/**
 * POST /api/page/drafts/sql — one statement of the reader's own draft (lib/page-drafts) that names one of its `default:`
 * links, run on the install's default connection as the signed-in reader: `{draft, sql, params?}` in, the page SQL
 * door's answer out (`{columns, rows}` or `{error, message}`). Only when the embedding app allowed live reads for that
 * draft (`liveSql`); read-only (lib/connections pageConnectionSql, the code a published page's door runs); the same
 * time and output limits. Same-origin only: it is the parent's relay, never the draft's own origin, which is refused
 * before it gets here (server/pages-host). Never cached.
 */
import { SQL_READ_LIMITS } from '@artifactbin/contracts';
import { browserActor } from '@/lib/authentication';
import { pageConnectionSql } from '@/lib/connections';
import { json, pagesSite, readJson } from '@/lib/http';
import { draftConnections } from '@/lib/page-drafts';
import { SQL_READ_WALL_TIMEOUT_MS } from '@/lib/platform';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  if (!actor.userId) return json({ error: 'permission_denied', message: 'sign in to read live data' }, 401, NO_STORE);
  if (request.headers.get('origin') !== pagesSite().app) return json({ error: 'forbidden', message: 'live data is read only through the app showing the draft' }, 403, NO_STORE);
  const body = await readJson(request);
  if (!body || typeof body.draft !== 'string' || typeof body.sql !== 'string') return json({ error: 'validation_failed', message: 'send {draft, sql, params?}' }, 400, NO_STORE);
  // Another reader's draft, a forgotten one, and one not allowed to read live answer alike.
  const connections = draftConnections(actor.userId, body.draft);
  if (!connections) return json({ error: 'unavailable', message: 'this draft may not read live data: show it again with live data allowed' }, 404, NO_STORE);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(SQL_READ_WALL_TIMEOUT_MS)]);
  const reply = await pageConnectionSql(actor, connections, { sql: body.sql, params: body.params }, signal);
  if (!reply) return json({ error: 'validation_failed', message: `a draft's live statement names one of its default: links (${connections.map((c) => c.name).join(', ') || 'none'})` }, 400, NO_STORE);
  const text = JSON.stringify(reply.body);
  if (new TextEncoder().encode(text).length > SQL_READ_LIMITS.outputBytes) return json({ error: 'result_too_large', message: `an answer is at most ${SQL_READ_LIMITS.outputBytes} bytes; select fewer rows or columns` }, 413, NO_STORE);
  return new Response(text, { status: reply.status, headers: { 'content-type': 'application/json', ...NO_STORE } });
}
