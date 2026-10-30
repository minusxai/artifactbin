/** Legacy bearer-to-browser login is closed. Keep sign-out available to clear
 * old ownership cookies; email login may still adopt their artifacts. */
import { agentSessionClearCookie, endPagesSessionsFor } from '@/lib/accounts';
import { refusesCrossSite, sessionActor } from '@/lib/authentication';
import { json } from '@/lib/http';

export async function POST(_request: Request) {
  return json({ error: 'email_auth_required' }, 401);
}

/**
 * Sign-out's server half: every pages session of the reader this request names is ended (a document's own origin
 * holds a host-only cookie only the server can revoke, lib/accounts/pages-sessions), and the old ownership cookie goes.
 */
export async function DELETE(request?: Request) {
  if (request) {
    const actor = await sessionActor(request);
    if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);
    await endPagesSessionsFor(actor);
  }
  return new Response(null, { status: 204, headers: {
    'Cache-Control': 'no-store', 'Set-Cookie': agentSessionClearCookie(),
  } });
}
