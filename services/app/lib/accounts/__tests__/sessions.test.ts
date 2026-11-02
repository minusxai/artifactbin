/** Current document-bound Pages tickets, sessions, liveness and sign-out. */
import { beforeEach, describe, expect, it } from 'vitest';
import { ANONYMOUS } from '@artifactbin/contracts';
import { request, createGuestOwner, testIdentity as baseIdentity, useAppHarness } from '@/__tests__/harness';
import { createUser, endPagesSession, endPagesSessionsFor, identityForUser, exchangePagesTicket, issuePagesTicket, mintToken, pagesSessionOf, revokeToken } from '@/lib/accounts';
import { pagesSessionActor } from '@/lib/accounts/pages-sessions';
import { setServices,getDb } from '@/lib/platform';

useAppHarness();

const testIdentity=(credential:Parameters<typeof baseIdentity>[0],ids:Parameters<typeof baseIdentity>[1]={})=>({...baseIdentity(credential,ids),...(credential==='session'?{sessionId:'test-session'}:{})});
beforeEach(()=>setServices({humanSessions:{live:async ref=>ref==='test-session'}}));


describe('pages tickets', () => {
  const binding = { artifactId: 'art_doc', origin: 'https://abc.pages.example.test' };
  const reader = async () => {
    const user = await createUser({ email: 'reader@example.test' });
    return { user, identity: testIdentity('session', { userId: user.id, email: user.email, emailVerified: true }) };
  };

  it('a ticket buys one session for its reader at its document, once', async () => {
    const { user, identity } = await reader();
    const ticket = await issuePagesTicket(identity, { grant: 'once' }, Date.now(), binding);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const spent = await exchangePagesTicket(ticket!, binding);
    expect(spent).toMatchObject({ actor: { credential: 'session', userId: user.id, email: user.email, emailVerified: true }, carried: { grant: 'once' }, repeat: false });
    expect(await exchangePagesTicket(ticket!, binding)).toBeNull();
    expect(await pagesSessionActor(spent!.cookie, binding.artifactId)).toEqual(spent!.actor);
    expect(await pagesSessionOf(spent!.cookie, Date.now(), binding.artifactId)).toEqual({ actor: spent!.actor, carried: { grant: 'once' } });
    // Only the cookie's hash is stored.
    const stored = await (await getDb()).query('SELECT 1 FROM pages_sessions WHERE id_hash = $1', [spent!.cookie]);
    expect(stored.rows).toHaveLength(0);
  });

  it('a ticket presented at another document or origin is refused and spent', async () => {
    const { identity } = await reader();
    for (const wrong of [{ ...binding, artifactId: 'art_other' }, { ...binding, origin: 'https://evil.example.test' }]) {
      const ticket = await issuePagesTicket(identity, {}, Date.now(), binding);
      expect(await exchangePagesTicket(ticket!, wrong)).toBeNull();
      expect(await exchangePagesTicket(ticket!, binding)).toBeNull();
    }
    expect(await exchangePagesTicket('short', binding)).toBeNull();
    expect(await exchangePagesTicket('x'.repeat(32), binding)).toBeNull();
  });

  it('a ticket lasts a minute; a session lasts eight hours and only at its own document', async () => {
    const { identity } = await reader();
    const t0 = Date.now();
    const late = await issuePagesTicket(identity, {}, t0, binding);
    expect(await exchangePagesTicket(late!, binding, t0 + 60_001)).toBeNull();
    const onTime = await issuePagesTicket(identity, {}, t0, binding);
    const spent = await exchangePagesTicket(onTime!, binding, t0 + 59_000);
    expect(spent).not.toBeNull();
    expect(await pagesSessionOf(spent!.cookie, t0 + 8 * 60 * 60 * 1000 - 1, binding.artifactId)).not.toBeNull();
    expect(await pagesSessionOf(spent!.cookie, t0 + 8 * 60 * 60 * 1000 + 59_001, binding.artifactId)).toBeNull();
    expect(await pagesSessionOf(spent!.cookie, t0, 'art_other')).toBeNull();
    expect(await pagesSessionActor(spent!.cookie, 'art_other', t0)).toBeNull();
    expect(await pagesSessionOf('not a cookie')).toBeNull();
    expect(await pagesSessionOf(null)).toBeNull();
  });

  it('a guest gets a ticket only to carry something, and reads as nobody', async () => {
    const guest = testIdentity('none');
    expect(await issuePagesTicket(guest, {}, Date.now(), binding)).toBeNull();
    const ticket = await issuePagesTicket(guest, { allow: ['https://api.example.test'] }, Date.now(), binding);
    const spent = await exchangePagesTicket(ticket!, binding);
    expect(spent).toMatchObject({ actor: ANONYMOUS, carried: { allow: ['https://api.example.test'] } });
    expect(await pagesSessionActor(spent!.cookie, binding.artifactId)).toBeNull();
    expect(await pagesSessionOf(spent!.cookie, Date.now(), binding.artifactId)).toEqual({ actor: ANONYMOUS, carried: { allow: ['https://api.example.test'] } });
  });

  it.each(['revoked', 'expired'])('a bearer gets a document-bound scripted session and loses it when its token is %s', async state => {
    const user = await createUser({ email: 'agent@example.test' });
    const minted = await mintToken('browser', user.id);
    const bearer = testIdentity('bearer', { userId: user.id, tokenId: minted.id });
    expect(await issuePagesTicket(bearer, {}, Date.now(), binding)).toBeNull();
    const ticket = await issuePagesTicket(bearer, {}, Date.now(), { ...binding, browserSession: true });
    const spent = await exchangePagesTicket(ticket!, binding);
    expect(spent!.actor).toEqual({ credential: 'agent-cookie', userId: user.id, tokenId: minted.id });
    if (state === 'revoked') await revokeToken(minted.id);
    else await (await getDb()).query("UPDATE tokens SET expires_at=now()-interval '1 second' WHERE id=$1", [minted.id]);
    expect(await pagesSessionActor(spent!.cookie, binding.artifactId)).toBeNull();
    const revokedTicket = await issuePagesTicket(bearer, {}, Date.now(), { ...binding, browserSession: true });
    expect(await exchangePagesTicket(revokedTicket!, binding)).toBeNull();
  });

  it('refuses a ticket to a reader whose account cannot authenticate', async () => {
    const guest = await createGuestOwner();
    expect(await issuePagesTicket(testIdentity('session', { userId: guest.userId }), {}, Date.now(), binding)).toBeNull();
    expect(await issuePagesTicket(testIdentity('session', { userId: 'usr_missing' }), {}, Date.now(), binding)).toBeNull();
  });

  it('a repeat view replaces the held session, and a cut-off retry with the same cookie gets the same session', async () => {
    const { identity } = await reader();
    const first = await exchangePagesTicket((await issuePagesTicket(identity, {}, Date.now(), binding))!, binding);
    const ticket = (await issuePagesTicket(identity, {}, Date.now(), binding))!;
    const second = await exchangePagesTicket(ticket, { ...binding, held: first!.cookie });
    expect(second).toMatchObject({ repeat: true });
    expect(await pagesSessionOf(first!.cookie, Date.now(), binding.artifactId)).toBeNull();
    const retry = await exchangePagesTicket(ticket, { ...binding, held: first!.cookie });
    expect(retry).toEqual(second);
    expect(await exchangePagesTicket(ticket, { ...binding, held: 'y'.repeat(43) })).toBeNull();
  });

  it('endPagesSession ends one session; endPagesSessionsFor ends every session of a reader', async () => {
    const { user, identity } = await reader();
    const other = await createUser({ email: 'other@example.test' });
    const otherIdentity = testIdentity('session', { userId: other.id, email: other.email });
    const spend = async (who: typeof identity) => (await exchangePagesTicket((await issuePagesTicket(who, {}, Date.now(), binding))!, binding))!.cookie;
    const a = await spend(identity), b = await spend(identity), c = await spend(otherIdentity);
    await endPagesSession(a);
    expect(await pagesSessionOf(a)).toBeNull();
    expect(await pagesSessionOf(b)).not.toBeNull();
    await endPagesSession(undefined);
    await endPagesSessionsFor(identityForUser(user.id));
    expect(await pagesSessionOf(b)).toBeNull();
    expect(await pagesSessionOf(c)).not.toBeNull();
  });
});

it('rechecks the originating human session on pages reads and refuses unbound legacy rows',async()=>{
 const user=await createUser({email:'mxmx_test_bound_pages@example.com'});
 const binding={artifactId:'bound_doc',origin:'https://bound.pages.example.test'};
 const identity={...testIdentity('session',{userId:user.id,email:user.email,emailVerified:true}),sessionId:'originating-session'};
 let live=true;setServices({humanSessions:{live:async(ref,owner)=>live&&ref===identity.sessionId&&owner===user.id}});
 const ticket=(await issuePagesTicket(identity,{},Date.now(),binding))!;
 const spent=await exchangePagesTicket(ticket,binding);expect(spent).not.toBeNull();
 const late=(await issuePagesTicket(identity,{},Date.now(),binding))!;
 live=false;
 expect(await pagesSessionOf(spent!.cookie)).toBeNull();
 expect(await exchangePagesTicket(late,binding)).toBeNull();
 live=true;const db=await getDb();await db.query('UPDATE pages_sessions SET human_session_id=NULL');
 expect(await pagesSessionOf(spent!.cookie)).toBeNull();
});

it.each(['session', 'bearer'] as const)('DELETE session/token ends %s-backed document authority', async credential => {
  const user = await createUser({ email: 'mxmx_test_logout_pages@example.test' });
  const token = await mintToken('logout-browser', user.id);
  const identity = { ...testIdentity(credential, { userId: user.id, tokenId: credential === 'bearer' ? token.id : null, email: user.email, emailVerified: true }) };
  const binding = { artifactId: 'logout_doc', origin: 'https://logout.pages.example.test', browserSession: credential === 'bearer' };
  const ticket = await issuePagesTicket(identity, {}, Date.now(), binding);
  const spent = await exchangePagesTicket(ticket!, binding);
  expect(await pagesSessionOf(spent!.cookie, Date.now(), binding.artifactId)).not.toBeNull();
  const { DELETE } = await import('@/app/api/session/token/route');
  const actor = credential === 'session'
    ? { credential, sessionId: 'test-session', userId: user.id, email: user.email, emailVerified: true }
    : { credential, userId: user.id, tokenId: token.id };
  const response = await DELETE(request('/api/session/token', { method: 'DELETE', actor, origin: 'same' }));
  expect(response.status).toBe(204);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await pagesSessionOf(spent!.cookie, Date.now(), binding.artifactId)).toBeNull();
});
