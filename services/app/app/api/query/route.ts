import { requestOrSessionActor } from '@/lib/authentication';
import { isCrossSiteRequest, json, readJson, unauthorized } from '@/lib/http';

/** Authenticated refusal for the retired draft compiler. */
export async function POST(request: Request) {
  // An agent's bearer, else the BROWSER's credential — the owner editing their own doc runs its draft
  // queries here. Anything but a bearer is cookie-authenticated, so a cross-site caller riding it is CSRF
  // (this compiles and runs the caller's markup).
  const actor = await requestOrSessionActor(request);
  if (actor.credential !== 'bearer' && isCrossSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  if (!actor.userId && !actor.tokenId) return unauthorized(request);

  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  if (typeof body.markup !== 'string') return json({ error: 'markup_required' }, 400);
  return json({error:'native_html_required'},400,{'Cache-Control':'no-store'});
}
