/**
 * lib/authentication's doors, through its index: who a request is (bearer, the proxy-attached session or agent cookie,
 * the direct session), and the refusals every door shares — no credential, an unknown, revoked or expired token, a
 * cookie-carried mutation from another site, a workspace account mismatch, a token whose hosted authority is
 * unavailable — plus the document-editor policy and the hosted operation hooks.
 */
import { BROWSER_SESSION_HEADER } from '@artifactbin/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness } from '@/__tests__/harness';
import { NO_IDENTITY, revokeToken } from '@/lib/accounts';
import {
  auth, browserActor, browserSessionKind, hostedAuthorization, hostedOperationCompleted, hostedRefusal, isBrowserSessionRequest,
  overrideSession, refusesCrossSite, requestActor, requestOrSessionActor, sessionActor, setDocumentEditorPolicy, withTokenAuth,
} from '@/lib/authentication';
import { getDb } from '@/lib/platform';

useAppHarness();
afterEach(() => setDocumentEditorPolicy(undefined));

const expire = async (tokenId: string) => (await getDb()).query("UPDATE tokens SET expires_at = now() - interval '1 second' WHERE id = $1", [tokenId]);
const scope = async (tokenId: string) => (await getDb()).query('UPDATE tokens SET request_authority = true WHERE id = $1', [tokenId]);
const session = (userId: string, email = 'reader@example.test') => ({ credential: 'session' as const, userId, email, emailVerified: true });
const status = (result: unknown) => (result instanceof Response ? result.status : 'identity');

describe('requestActor (bearer or session)', () => {
  it('admits a live bearer token as its owner', async () => {
    const t = await mintAccountToken('cli');
    const actor = await requestActor(request('/x', { token: t.token }));
    expect(actor).toMatchObject({ userId: t.userId, tokenId: t.id, credential: 'bearer' });
  });

  it('answers 401 for nobody, an unknown token, a revoked token and an expired token', async () => {
    const revoked = await mintAccountToken('revoked'), expired = await mintAccountToken('expired');
    await revokeToken(revoked.id);
    await expire(expired.id);
    for (const token of [undefined, 'afb_not_a_token', revoked.token, expired.token]) {
      const result = await requestActor(request('/x', { method: 'POST', token }));
      expect(status(result), String(token)).toBe(401);
    }
  });

  it('refuses a cookie-carried mutation from another site, but not a read or a bearer call', async () => {
    const t = await mintAccountToken('cli');
    const actor = session(t.userId!);
    expect(status(await requestActor(request('/x', { method: 'POST', actor, origin: 'https://evil.example' })))).toBe(403);
    expect(status(await requestActor(request('/x', { method: 'GET', actor, origin: 'https://evil.example' })))).toBe('identity');
    expect(status(await requestActor(request('/x', { method: 'POST', actor, origin: 'same' })))).toBe('identity');
    expect(status(await requestActor(request('/x', { method: 'POST', token: t.token, origin: 'https://evil.example' })))).toBe('identity');
  });

  it('reads an invalid bearer as nobody on the shared door', async () => {
    expect(await requestOrSessionActor(request('/x', { token: 'afb_unknown' }))).toEqual(NO_IDENTITY);
  });
});

describe('withTokenAuth (token holders only)', () => {
  const handler = vi.fn(async (_request: Request, ctx: { actor: { userId: string | null }; params: Record<string, string> }) => Response.json({ who: ctx.actor.userId, params: ctx.params }));
  const door = withTokenAuth(handler as never);

  it('runs the handler for a live token with its route params and stamps the account it acted as', async () => {
    const t = await mintAccountToken('cli');
    const response = await door(request('/x', { token: t.token }), { params: Promise.resolve({ id: 'doc1' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ who: t.userId, params: { id: 'doc1' } });
    expect(response.headers.get('X-Artifactbin-Account')).toBe(t.userId);
  });

  it('answers 401 without a token, for an unknown, revoked or expired one, and for a session that holds no token', async () => {
    const revoked = await mintAccountToken('revoked'), expired = await mintAccountToken('expired');
    await revokeToken(revoked.id);
    await expire(expired.id);
    handler.mockClear();
    for (const token of [undefined, 'afb_unknown', revoked.token, expired.token]) expect((await door(request('/x', { token }))).status, String(token)).toBe(401);
    expect((await door(request('/x', { actor: session(revoked.userId!) }))).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers 409 when the caller names another workspace account', async () => {
    const t = await mintAccountToken('cli');
    const response = await door(request('/x', { token: t.token, headers: { 'X-Artifactbin-Account': 'someone-else' } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'account_mismatch', actual_account: t.userId });
  });

  it('refuses a token whose hosted request authority is unavailable', async () => {
    const t = await mintAccountToken('scoped');
    await scope(t.id);
    const response = await door(request('/x', { token: t.token }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'agent_authority_unavailable', admission_refused: true });
  });
});

describe('the session door', () => {
  it('admits the attached session and ignores a bearer header', async () => {
    const t = await mintAccountToken('cli');
    expect(await sessionActor(request('/x', { actor: session(t.userId!) }))).toMatchObject({ userId: t.userId, credential: 'session' });
    expect(await sessionActor(request('/x', { token: t.token }))).toEqual(NO_IDENTITY);
    expect(status(await browserActor(request('/x', { token: t.token })))).toBe(401);
    expect(status(await browserActor(request('/x', { actor: session(t.userId!) })))).toBe('identity');
    expect(status(await browserActor(request('/x', { method: 'DELETE', actor: session(t.userId!), origin: 'https://evil.example' })))).toBe(403);
  });

  it('falls back to the direct session only when not limited to headers', async () => {
    const t = await mintAccountToken('cli');
    setSession({ user: { id: t.userId!, email: 'direct@example.test' } });
    expect(await sessionActor(request('/x'))).toMatchObject({ userId: t.userId, credential: 'session' });
    expect(await sessionActor(request('/x'), { headerOnly: true })).toEqual(NO_IDENTITY);
    expect(await auth()).toEqual({ user: { id: t.userId, email: 'direct@example.test' } });
    overrideSession(undefined);
    expect(await auth()).toBeNull();
  });

  it('knows a browser-session request and which kind of session it is', async () => {
    const t = await mintAccountToken('cli');
    expect(isBrowserSessionRequest(request('/x', { headers: { [BROWSER_SESSION_HEADER]: '1' } }))).toBe(false);
    expect(isBrowserSessionRequest(request('/x', { actor: session(t.userId!), headers: { [BROWSER_SESSION_HEADER]: '1' } }))).toBe(true);
    expect(isBrowserSessionRequest(request('/x', { actor: session(t.userId!) }))).toBe(false);
    expect(await browserSessionKind(request('/x', { actor: session(t.userId!) }))).toBe('account');
    expect(await browserSessionKind(request('/x'))).toBe('none');
    expect(await browserSessionKind(undefined, { ...NO_IDENTITY, credential: 'bearer', userId: t.userId, tokenId: t.id })).toBe('none');
  });

  it('marks a verified session a document editor only when the deployment\'s policy says so', async () => {
    const t = await mintAccountToken('cli');
    expect(await sessionActor(request('/x', { actor: session(t.userId!, 'ed@corp.example') }))).toMatchObject({ documentEditor: false });
    setDocumentEditorPolicy(account => account.emailVerified === true && !!account.email?.endsWith('@corp.example'));
    expect(await sessionActor(request('/x', { actor: session(t.userId!, 'ed@corp.example') }))).toMatchObject({ documentEditor: true });
    expect(await sessionActor(request('/x', { actor: { ...session(t.userId!, 'ed@corp.example'), emailVerified: false } }))).toMatchObject({ documentEditor: false });
    expect(await sessionActor(request('/x', { actor: session(t.userId!, 'out@else.example') }))).toMatchObject({ documentEditor: false });
  });
});

describe('cross-site refusal', () => {
  it('applies to cookie credentials on mutations from another site only', () => {
    const cross = (method: string) => request('/x', { method, origin: 'https://evil.example' });
    expect(refusesCrossSite(cross('POST'), { credential: 'session' })).toBe(true);
    expect(refusesCrossSite(cross('PUT'), { credential: 'agent-cookie' })).toBe(true);
    expect(refusesCrossSite(cross('POST'), { credential: 'bearer' })).toBe(false);
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(refusesCrossSite(cross(method), { credential: 'session' }), method).toBe(false);
    expect(refusesCrossSite(request('/x', { method: 'POST', origin: 'same' }), { credential: 'session' })).toBe(false);
  });
});

describe('hosted operation authority', () => {
  it('is ordinary without an owner or token, denied for a dead credential, and unavailable for a scoped one', async () => {
    const t = await mintAccountToken('cli');
    expect(await hostedAuthorization(null, t.id, 'op', {})).toEqual({ kind: 'ordinary' });
    expect(await hostedAuthorization(t.userId, null, 'op', {})).toEqual({ kind: 'ordinary' });
    expect(await hostedAuthorization(t.userId, t.id, 'op', {})).toEqual({ kind: 'ordinary' });
    expect(await hostedAuthorization('someone-else', t.id, 'op', {})).toMatchObject({ kind: 'denied', code: 'agent_credential_invalid' });
    const scoped = await mintAccountToken('scoped');
    await scope(scoped.id);
    expect(await hostedAuthorization(scoped.userId, scoped.id, 'op', {})).toMatchObject({ kind: 'denied', code: 'agent_authority_unavailable' });
  });

  it('answers a denial with 403, a deferral with 202, and lets the rest through', async () => {
    const denied = hostedRefusal({ kind: 'denied', code: 'nope', message: 'No.' })!;
    expect([denied.status, await denied.json()]).toEqual([403, { error: 'nope', message: 'No.', admission_refused: true }]);
    const deferred = hostedRefusal({ kind: 'deferred', body: { pending: true } })!;
    expect([deferred.status, await deferred.json()]).toEqual([202, { pending: true }]);
    expect(hostedRefusal({ kind: 'ordinary' })).toBeNull();
    expect(hostedRefusal({ kind: 'allowed' })).toBeNull();
    await expect(hostedOperationCompleted('u', 't', 'op', {}, new Response())).resolves.toBeUndefined();
  });
});

it('honors the identity owner refusal instead of re-admitting a raw bearer from app storage',async()=>{
 const t=await mintAccountToken('owner-refused');
 const response=await withTokenAuth(async()=>Response.json({ok:true}))(request('/api/account/profile',{headers:{authorization:`Bearer ${t.token}`},actor:{credential:'none'}}));
 expect(response.status).toBe(401);
});

it('requires matching auth-owner admission for OAuth audience-bound bearers even on a direct app port',async()=>{
 const t=await mintAccountToken('oauth');await (await getDb()).query('UPDATE tokens SET audience=$2 WHERE id=$1',[t.id,'http://localhost:3000/api']);
 const door=withTokenAuth(async()=>Response.json({ok:true}));
 expect((await door(request('/api/account/profile',{token:t.token}))).status).toBe(401);
 expect((await door(request('/api/account/profile',{headers:{authorization:`Bearer ${t.token}`},actor:{credential:'bearer',tokenId:t.id,userId:t.userId!}}))).status).toBe(200);
});
