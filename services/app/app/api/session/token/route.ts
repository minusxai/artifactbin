/** Legacy bearer-to-browser login is closed. Keep sign-out available to clear
 * old ownership cookies; email login may still adopt their artifacts. */
import { agentSessionClearCookie } from '@/lib/accounts';
import { json } from '@/lib/http';

export async function POST(_request: Request) {
  return json({ error: 'email_auth_required' }, 401);
}

export async function DELETE(_request?: Request) {
  return new Response(null, { status: 204, headers: {
    'Cache-Control': 'no-store', 'Set-Cookie': agentSessionClearCookie(),
  } });
}
