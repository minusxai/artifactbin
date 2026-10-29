/** Browser credentials: the signed agent-session cookie, and the one-time pages tickets a document origin exchanges. */
import { describe, expect, it } from 'vitest';
import { ANONYMOUS } from '@artifactbin/contracts';
import { agentCookie, createGuestOwner, request, testIdentity, useAppHarness } from '@/__tests__/harness';
import {
  AGENT_COOKIE, agentSessionClearCookie, agentSessionSetCookie, createUser, decodeAgentSessionEnvelope, encodeAgentSession,
  endPagesSession, endPagesSessionsFor, identityForUser, exchangePagesTicket, issuePagesTicket, liveAgentSession, mintToken, pagesSessionActor,
  pagesSessionOf, revokeToken, withToken, withoutToken,
} from '@/lib/accounts';
import { getDb } from '@/lib/platform';

const harness = useAppHarness();

const SESSION_ID = 'A'.repeat(43);

describe('agent session envelope', () => {
  // Pure: no rows, so the describe skips the per-test wipe.
  harness.shared(async () => undefined);
  it('round-trips the held token ids and a session id, minting one when absent', async () => {
    const kept = await decodeAgentSessionEnvelope(await encodeAgentSession({ tokenIds: ['tok_a', 'tok_b'], sessionId: SESSION_ID }));
    expect(kept).toEqual({ tokenIds: ['tok_a', 'tok_b'], sessionId: SESSION_ID });
    const minted = await decodeAgentSessionEnvelope(await encodeAgentSession({ tokenIds: ['tok_a'] }));
    expect(minted!.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('fails closed on a tampered, foreign, empty or absent envelope', async () => {
    const value = await encodeAgentSession({ tokenIds: ['tok_a'], sessionId: SESSION_ID });
    const [payload, signature] = value.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ tokenIds: ['tok_admin'], sessionId: SESSION_ID })).toString('base64url');
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    for (const bad of [`${forged}.${signature}`, `${payload}.${flipped}`, payload, `.${signature}`, 'garbage', '', undefined, null]) {
      expect(await decodeAgentSessionEnvelope(bad), String(bad)).toBeNull();
    }
    expect(await decodeAgentSessionEnvelope(await encodeAgentSession({ tokenIds: [] }))).toBeNull();
  });

  it('withToken appends (moving a repeat to the end, keeping the last 8); withoutToken drops one or empties to null', () => {
    expect(withToken(null, 'a')).toEqual({ tokenIds: ['a'] });
    expect(withToken({ tokenIds: ['a', 'b', 'c'] }, 'a')).toEqual({ tokenIds: ['b', 'c', 'a'] });
    const nine = Array.from({ length: 9 }, (_, i) => `t${i}`).reduce<{ tokenIds: string[] } | null>((s, id) => withToken(s, id), null);
    expect(nine!.tokenIds).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
    expect(withoutToken({ tokenIds: ['a', 'b', 'c'] }, 'b')).toEqual({ tokenIds: ['a', 'c'] });
    expect(withoutToken({ tokenIds: ['a'] }, 'a')).toBeNull();
    expect(withoutToken(null, 'a')).toBeNull();
  });

  it('sets and clears the cookie with the same attributes', () => {
    const set = agentSessionSetCookie('v.s');
    const clear = agentSessionClearCookie();
    expect(set).toMatch(new RegExp(`^${AGENT_COOKIE}=v\\.s; Path=/; Max-Age=2592000; SameSite=lax; HttpOnly`));
    expect(clear).toMatch(new RegExp(`^${AGENT_COOKIE}=; Path=/; Max-Age=0; SameSite=lax; HttpOnly`));
    expect(set.replace(/=v\.s;/, '=;').replace(/Max-Age=\d+/, '')).toBe(clear.replace(/Max-Age=\d+/, ''));
  });
});

describe('agent session liveness', () => {

  it('is live only while its browser credential row is live, and the proxy-attached actor wins', async () => {
    const cookie = await agentCookie(['tok_old', 'tok_primary']);
    expect(await liveAgentSession(request('/x', { cookie }))).toMatchObject({ tokenIds: ['tok_old', 'tok_primary'] });
    const db = await getDb();
    await db.query("UPDATE auth.credentials SET expires_at = now() - interval '1 second'");
    expect(await liveAgentSession(request('/x', { cookie }))).toBeNull();
    const revoked = await agentCookie(['tok_primary']);
    await db.query('UPDATE auth.credentials SET deleted_at = now()');
    expect(await liveAgentSession(request('/x', { cookie: revoked }))).toBeNull();
    const unregistered = `${AGENT_COOKIE}=${await encodeAgentSession({ tokenIds: ['tok_primary'] })}`;
    expect(await liveAgentSession(request('/x', { cookie: unregistered }))).toBeNull();
    expect(await liveAgentSession(request('/x'))).toBeNull();
    expect(await liveAgentSession(request('/x', { actor: { credential: 'session', userId: 'usr_x', heldTokenIds: ['tok_h'] } }))).toEqual({ tokenIds: ['tok_h'] });
    expect(await liveAgentSession(request('/x', { actor: { credential: 'session', userId: 'usr_x' }, cookie }))).toBeNull();
  });
});

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

  it('a bearer gets a ticket only as a scripted browser session, and loses it when its token is revoked', async () => {
    const user = await createUser({ email: 'agent@example.test' });
    const minted = await mintToken('browser', user.id);
    const bearer = testIdentity('bearer', { userId: user.id, tokenId: minted.id });
    expect(await issuePagesTicket(bearer, {}, Date.now(), binding)).toBeNull();
    const ticket = await issuePagesTicket(bearer, {}, Date.now(), { ...binding, browserSession: true });
    const spent = await exchangePagesTicket(ticket!, binding);
    expect(spent!.actor).toEqual({ credential: 'agent-cookie', userId: user.id, tokenId: minted.id });
    await revokeToken(minted.id);
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
