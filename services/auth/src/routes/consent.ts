/**
 * The authorization step of the code flow, `mountConsent(app, o)`: `GET /oauth/authorize` checks the request and
 * answers with a consent page, a login page, or (a FIRST-PARTY client, IDENTITY__OAUTH_CLIENTS `first_party`) the code
 * at once, bound to the browser session; `POST /oauth/authorize/approve` checks every field of the page's form again.
 * Page and form live together: the hidden fields one writes are the ones the other reads. A GROUP'S SIGN-IN is said
 * plainly on the page, never for a first-party client or a service, and the level held is checked at both steps.
 */
import { BodyTooLargeError, readBody } from '@artifactbin/utils/body';
import { renderConnectionPage } from '@artifactbin/utils/connection-page';
import { escapeHtml } from '@artifactbin/utils/escape';
import { ANONYMOUS, isGroupPrincipalRole } from '@artifactbin/contracts/actor';
import { clientRedirects, createAuthCode, isValidCodeChallenge } from '../identity/oauth';
import type { AuthApp } from '../parts';
import { AUTH_BODY_LIMIT, NO_STORE, acceptsResource, isSameOrigin, payloadTooLarge, resourceOf, scopeFor, serviceAt, type GrantGroup, type OAuthRoutesOptions } from './grants';

function formActionOrigin(redirectUri: string): string {
  try { return new URL(redirectUri).origin; } catch { return ''; }
}

function page(title: string, body: string, status = 200, redirectUri = ''): Response {
  const formAction = ["'self'", formActionOrigin(redirectUri)].filter(Boolean).join(' ');
  return new Response(
    renderConnectionPage(title, body),
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}` } },
  );
}
/** The page that says the connection cannot be made, and why (`problem` is escaped). */
const cantConnect = (problem: string, status: number) => page('artifactbin — error', `<h1>Can’t connect</h1><p class="err">${escapeHtml(problem)}</p>`, status);

/** A request's group principal: none (null), a valid one, or undefined when only one of the two is named or the level is not member or editor. */
const groupAsked = (id: unknown, role: unknown): GrantGroup | null | undefined =>
  (id === null || id === undefined || id === '') && (role === null || role === undefined || role === '') ? null
  : typeof id === 'string' && id.length > 0 && id.length <= 128 && isGroupPrincipalRole(role) ? { id, role } : undefined;

export function mountConsent(app: AuthApp, o: OAuthRoutesOptions): void {
  app.get('/oauth/authorize', async (c) => {
    const q = new URL(c.req.url).searchParams;
    const clientId = q.get('client_id') ?? '';
    const redirectUri = q.get('redirect_uri') ?? '';
    const codeChallenge = q.get('code_challenge') ?? '';
    const method = q.get('code_challenge_method') ?? '';
    const state = q.get('state') ?? '';
    const requestedResource = q.get('resource') ?? resourceOf(o, c.req.raw);
    const scope = scopeFor(o, requestedResource, q.get('scope') ?? '');
    const client = clientId ? await o.oauth.client(clientId) : null;
    const group = groupAsked(q.get('group_id'), q.get('group_role'));
    const service = serviceAt(o, requestedResource);
    const problem =
      !client ? 'Unknown client.'
      : group === undefined ? 'Name group_id with group_role member or editor.'
      : group && (client.firstParty || service) ? 'A group sign-in needs this API and a consent page.'
      : q.get('response_type') !== 'code' ? 'Unsupported response type.'
      : !isValidCodeChallenge(codeChallenge) || method !== 'S256' ? 'Invalid PKCE code challenge.'
      : !clientRedirects(client, redirectUri) ? 'Redirect URI not registered.'
      : !acceptsResource(o, c.req.raw, requestedResource) ? 'Invalid API resource.'
      : scope === null ? 'Unsupported scope.'
      : null;
    if (problem || !client || group === undefined || scope === null) return cantConnect(problem ?? '', 400);
    const actor = c.get('actor') ?? ANONYMOUS;
    const retryPath = `/oauth/authorize?${q.toString()}`;
    if (client.firstParty) {
      // Part of this deployment's sign-in: no consent page. Signed out, the login page, then here again.
      if (actor.credential !== 'session' || !actor.userId) return new Response(null, { status: 303, headers: { Location: `/login?callbackUrl=${encodeURIComponent(retryPath)}`, ...NO_STORE } });
      if (!actor.sessionId) return cantConnect('Sign in again.', 400);
      const url = new URL(redirectUri);
      url.searchParams.set('code', await createAuthCode(o.oauth, { userId: actor.userId, clientId, redirectUri, resource: requestedResource, scope, sessionId: actor.sessionId }, codeChallenge));
      if (state) url.searchParams.set('state', state);
      return new Response(null, { status: 303, headers: { Location: url.href, ...NO_STORE, 'Referrer-Policy': 'no-referrer' } });
    }
    const fields = `<input type="hidden" name="client_id" value="${escapeHtml(clientId)}"><input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}"><input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}"><input type="hidden" name="resource" value="${escapeHtml(requestedResource)}"><input type="hidden" name="scope" value="${escapeHtml(scope)}"><input type="hidden" name="state" value="${escapeHtml(state)}">${group ? `<input type="hidden" name="group_id" value="${escapeHtml(group.id)}"><input type="hidden" name="group_role" value="${escapeHtml(group.role)}">` : ''}`;
    // Only an operator-registered client is named: a dynamic client's name is whatever it registered with.
    const who = client.configured ? `<strong>${escapeHtml(client.clientName)}</strong>` : service ? 'An application' : 'Your coding agent';
    const email = escapeHtml(actor.email ?? 'your account');
    const approve = (grant: 'group' | 'user') => `<form method="POST" action="/oauth/authorize/approve">${fields}<input type="hidden" name="grant" value="${grant}"><button type="submit" name="action" value="approve" aria-label="Approve connection">Approve</button><button type="submit" name="action" value="deny">Deny</button></form>`;
    if (actor.credential === 'session' && actor.userId && group) {
      // Acting as a GROUP: said plainly, the level held checked now and again at approval.
      const name = await o.groupSignIns?.heldName(actor.userId, group.id, group.role).catch(() => null) ?? null;
      if (!name) return cantConnect('You can sign an agent in as a group only at a level you hold there.', 403);
      return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
      <p>${client.configured ? who : 'Your coding agent'} wants to act as the group <strong>${escapeHtml(name)}</strong> at <strong>${group.role}</strong> level, not as you (${email}). It can do what a ${group.role} of ${escapeHtml(name)} can do with the group’s pages, and nothing of yours. It stops when you no longer hold that level there.</p>
      ${approve('group')}`, 200, redirectUri);
    }
    if (actor.credential === 'session' && actor.userId) {
      return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
      ${service ? `<p>${who} wants to act as you at <strong>${escapeHtml(service.id)}</strong> (${escapeHtml(service.origin)}), as <strong>${email}</strong>. It cannot use this site as you.</p>` : client.configured ? `<p>${who} wants to use this site as <strong>${email}</strong>: read what you may and publish as you.</p>` : `<p>Your coding agent wants to publish artifacts. New artifacts will belong to <strong>${email}</strong>.</p>`}
      ${approve('user')}`, 200, redirectUri);
    }
    return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
    <p>Your coding agent wants to publish artifacts — shareable pages it creates and updates. Log in with your email to connect it; artifacts will belong to your account.</p>
    <form method="GET" action="/login"><input type="hidden" name="callbackUrl" value="${escapeHtml(retryPath)}"><button type="submit" aria-label="Log in to connect">Log in with email</button></form>
    <p class="alt">No password needed — we email you a code.</p>`, 200, redirectUri);
  });

  app.post('/oauth/authorize/approve', async (c) => {
    if (!isSameOrigin(o, c.req.raw)) return c.json({error:'invalid_origin'},403);
    let form: FormData;
    try {
      const bytes = await readBody(c.req.raw, { limit: AUTH_BODY_LIMIT });
      form = await new Response(bytes, { headers: { 'content-type': c.req.header('content-type') ?? '' } }).formData();
    } catch (error) { if (error instanceof BodyTooLargeError) return payloadTooLarge(); throw error; }
    const clientId = String(form.get('client_id') ?? '');
    const redirectUri = String(form.get('redirect_uri') ?? '');
    const codeChallenge = String(form.get('code_challenge') ?? '');
    const requestedResource = String(form.get('resource') ?? '');
    const scope = String(form.get('scope') ?? '');
    const state = form.get('state');
    const client = clientId ? await o.oauth.client(clientId) : null;
    const group = groupAsked(form.get('group_id'), form.get('group_role'));
    if (!client || !clientRedirects(client, redirectUri) || !isValidCodeChallenge(codeChallenge) || !acceptsResource(o, c.req.raw, requestedResource) || scopeFor(o, requestedResource, scope) !== scope
      || group === undefined || (group && (client.firstParty || serviceAt(o, requestedResource)))) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const actor = c.get('actor') ?? ANONYMOUS;
    if (actor.credential !== 'session' || !actor.userId) return c.json({ error: 'unauthorized' }, 401);
    // A first-party grant is always bound to the browser session that approved it, also when approved by form.
    if (client.firstParty && !actor.sessionId) return c.json({ error: 'unauthorized' }, 401);
    const url = new URL(redirectUri);
    if (form.get('action') === 'deny') {
      url.searchParams.set('error','access_denied');
      if (typeof state === 'string' && state) url.searchParams.set('state',state);
      return Response.redirect(url,303);
    }
    // The fields are the browser's: the level is checked again here, and the code carries the group, never the token body.
    if (group && !await o.groupSignIns?.heldName(actor.userId, group.id, group.role).catch(() => null)) return c.json({ error: 'group_level_not_held' }, 403);
    url.searchParams.set('code', await createAuthCode(o.oauth, { userId: actor.userId, clientId, redirectUri, resource: requestedResource, scope, ...(client.firstParty ? { sessionId: actor.sessionId } : {}), ...(group ? { group } : {}) }, codeChallenge));
    if (typeof state === 'string' && state) url.searchParams.set('state', state);
    return Response.redirect(url, 303);
  });
}
