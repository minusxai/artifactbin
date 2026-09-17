/**
 * THE HANDOFF: the app reads the actor the proxy ATTACHED to the Request (utils actorOf), and only
 * that. There is no signed-header fallback, so no header — forged or correctly signed — is anybody.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachActor, signActor } from '@artifactbin/utils';
import { ACTOR_HEADER, BROWSER_SESSION_HEADER } from '@artifactbin/contracts';
import { sessionActor, tokenActorForRequest } from '@/lib/viewer';
import { mintToken, revokeToken } from '@/lib/tokens';

describe('sessionActor', () => {
  it('prefers the actor attached to the Request over any header', async () => {
    const req = new Request('http://x/api/page/session', { headers: { [ACTOR_HEADER]: signActor({ credential: 'bearer', tokenId: 'tok_forged' }, 'x'.repeat(32)) } });
    attachActor(req, { credential: 'session', userId: 'usr_attached', email: 'a@example.com', emailVerified: true });
    const actor = await sessionActor(req);
    expect(actor.credential).toBe('session');
    expect(actor.viewer?.userId).toBe('usr_attached');
  });
  it('with nothing attached and no valid header, resolves in-process and answers nobody for an anonymous request', async () => {
    const actor = await sessionActor(new Request('http://x/api/page/session'));
    expect(actor.credential).toBe('none');
    expect(actor.viewer).toBeNull();
  });

  it('revalidates a long-lived browser session identity after its token is revoked', async () => {
    const token = await mintToken('mxmx_test_browser_session');
    const request = new Request('http://x/a/abc123', { headers: { [BROWSER_SESSION_HEADER]: '1' } });
    attachActor(request, { credential: 'bearer', tokenId: token.id });
    try {
      expect((await sessionActor(request)).tokenId).toBe(token.id);
      await revokeToken(token.id);
      expect(await sessionActor(request)).toMatchObject({ credential: 'none', tokenId: null, viewer: null });
    } finally { await revokeToken(token.id); }
  });

  /*
   * There is no header fallback, so a header signed with the REAL secret — not
   * merely a forged one — is nobody too.
   */
  it('a correctly signed header alone is nobody: the fallback is gone', async () => {
    const secret = 's'.repeat(32);
    vi.stubEnv('CONTRACT__ACTOR_SECRET', secret); vi.resetModules();
    const { sessionActor: fresh } = await import('@/lib/viewer');
    const req = new Request('http://x/api/page/session', {
      headers: { [ACTOR_HEADER]: signActor({ credential: 'session', userId: 'usr_header', email: 'h@example.com', emailVerified: true }, secret) },
    });
    const actor = await fresh(req);
    expect(actor.credential).toBe('none');
    expect(actor.viewer).toBeNull();
  });
});

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

 describe('verified token scope',()=>{
   it('accepts claims only for the resolved token and account, and excludes document automation',()=>{
     const scope={userId:'usr_admin',tokenId:'tok_admin'};
     const req=new Request('http://x/api/artifacts/abc123');
     attachActor(req,{credential:'bearer',...scope,email:'admin@example.com',emailVerified:true});
     expect(tokenActorForRequest(req,scope)).toMatchObject({email:'admin@example.com',emailVerified:true});
     expect(tokenActorForRequest(req,{...scope,tokenId:'tok_other'}).emailVerified).toBeUndefined();
     expect(tokenActorForRequest(req,{...scope,userId:'usr_other'}).emailVerified).toBeUndefined();
     req.headers.set(BROWSER_SESSION_HEADER,'1');
     expect(tokenActorForRequest(req,scope).emailVerified).toBeUndefined();
   });
 });
