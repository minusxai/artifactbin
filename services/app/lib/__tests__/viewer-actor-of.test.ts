/**
 * THE HANDOFF: the app reads the actor the proxy ATTACHED to the Request (utils actorOf), and only
 * that. There is no signed-header fallback, so no header — forged or correctly signed — is anybody.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachActor, signActor } from '@artifactbin/utils';
import { ACTOR_HEADER, BROWSER_SESSION_HEADER } from '@artifactbin/contracts';
import { requestOrSessionActor, sessionActor, setDocumentEditorPolicy } from '@/lib/authentication';
import { revokeToken } from '@/lib/accounts';
import { mintAccountToken as mintToken, useAppHarness } from '@/__tests__/harness';

useAppHarness();

describe('sessionActor', () => {
  it('prefers the actor attached to the Request over any header', async () => {
    const req = new Request('http://x/api/page/session', { headers: { [ACTOR_HEADER]: signActor({ credential: 'bearer', tokenId: 'tok_forged' }, 'x'.repeat(32)) } });
    attachActor(req, { credential: 'session', userId: 'usr_attached', email: 'a@example.com', emailVerified: true });
    const actor = await sessionActor(req);
    expect(actor.credential).toBe('session');
    expect(actor.userId).toBe('usr_attached');
  });
  it('with nothing attached and no valid header, resolves in-process and answers nobody for an anonymous request', async () => {
    const actor = await sessionActor(new Request('http://x/api/page/session'));
    expect(actor.credential).toBe('none');
    expect(actor.userId).toBeNull();
  });

  it('revalidates a long-lived browser session identity after its token is revoked', async () => {
    const token = await mintToken('mxmx_test_browser_session');
    const request = new Request('http://x/a/abc123', { headers: { [BROWSER_SESSION_HEADER]: '1' } });
    attachActor(request, { credential: 'bearer', tokenId: token.id, userId: token.userId! });
    try {
      expect((await sessionActor(request)).tokenId).toBe(token.id);
      await revokeToken(token.id);
      expect(await sessionActor(request)).toMatchObject({ credential: 'none', tokenId: null, userId: null });
    } finally { await revokeToken(token.id); }
  });

  /*
   * There is no header fallback, so a header signed with the REAL secret — not
   * merely a forged one — is nobody too.
   */
  it('a correctly signed header alone is nobody: the fallback is gone', async () => {
    const secret = 's'.repeat(32);
    vi.stubEnv('CONTRACT__ACTOR_SECRET', secret); vi.resetModules();
    const { sessionActor: fresh } = await import('@/lib/authentication/request-identity');
    const req = new Request('http://x/api/page/session', {
      headers: { [ACTOR_HEADER]: signActor({ credential: 'session', userId: 'usr_header', email: 'h@example.com', emailVerified: true }, secret) },
    });
    const actor = await fresh(req);
    expect(actor.credential).toBe('none');
    expect(actor.userId).toBeNull();
  });
});

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

 describe('verified bearer claims',()=>{
   it('attach claims only for the resolved token and account, and never under the browser-session header',async()=>{
     const token=await mintToken('mxmx_test_claims');
     setDocumentEditorPolicy(account=>account.userId===token.userId&&account.emailVerified===true);
     try{
       const bearer=(claims:{userId:string;tokenId:string},headers:Record<string,string>={})=>{
         const req=new Request('http://x/api/artifacts/abc123',{headers:{authorization:`Bearer ${token.token}`,...headers}});
         return attachActor(req,{credential:'bearer',...claims,email:'admin@example.com',emailVerified:true});
       };
       const own={userId:token.userId!,tokenId:token.id};
       expect(await requestOrSessionActor(bearer(own))).toMatchObject({...own,email:'admin@example.com',emailVerified:true,documentEditor:true});
       expect(await requestOrSessionActor(bearer({...own,tokenId:'tok_other'}))).toMatchObject({...own,email:null,emailVerified:null,documentEditor:false});
       expect(await requestOrSessionActor(bearer({...own,userId:'usr_other'}))).toMatchObject({...own,email:null,emailVerified:null,documentEditor:false});
       expect(await requestOrSessionActor(bearer(own,{[BROWSER_SESSION_HEADER]:'1'}))).toMatchObject({...own,emailVerified:null,documentEditor:false});
     }finally{setDocumentEditorPolicy();await revokeToken(token.id);}
   });
 });
