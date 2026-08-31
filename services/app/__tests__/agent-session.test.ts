/**
 * The browser holds an httpOnly session cookie, never a bearer secret.
 *
 * Four properties, each of which was a real way to get this wrong:
 *
 *  1. the exchange is a CREDENTIAL CHECK — an unknown or revoked token buys
 *     nothing, and the cookie that comes back names token ids, never the secret;
 *  2. the anonymous session is INVISIBLE to `auth()` — every `if
 *     (!session?.user?.id)` guard must keep failing closed, or `claimToken`
 *     would write a token id into `tokens.user_id`;
 *  3. authorization is RE-READ per request: revoking the token logs the
 *     browser out on the next call, not at some expiry;
 *  4. the cookie reaches artifact routes with TOKEN scope — the same reach the
 *     localStorage token had, and no more.
 */
import { describe, expect, it, vi } from 'vitest';
import { DELETE as sessionDelete, POST as exchangeRoute } from '@/app/api/session/token/route';
import { GET as listMine } from '@/app/api/my/artifacts/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as agentPrompt } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { servesDocumentDirectly } from '@/server/app';
import { AGENT_COOKIE, decodeAgentSession, encodeAgentSession } from '@/lib/agent-session';
import { existingPaste } from '@/lib/agent-copy';
import { mintToken, resolveTokenById, revokeToken } from '@/lib/tokens';
import { claimableTokensById, claimTokenById, createUser } from '@/lib/users';
import { getArtifactFor } from '@/lib/artifacts';
import { useAppHarness, request } from '@/__tests__/harness';

// harness-exempt: cookie exercises the agent-session codec and cookie attributes themselves

const BASE = 'http://localhost:3000';

/** A stand-in NextAuth session, so the account path can be exercised too. */
const sessionUser = { id: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));

useAppHarness();

/** The Set-Cookie value the exchange handed back, as a bare cookie value. */
const cookieFrom = (res: Response): string | null => {
  const raw = res.headers.get('set-cookie');
  const m = raw && new RegExp(`${AGENT_COOKIE}=([^;]+)`).exec(raw);
  return m ? m[1] : null;
};
const cookieHeader = (value: string | null) => value ? `${AGENT_COOKIE}=${value}` : '';

describe('POST /api/session/token', () => {
  it('exchanges a live token for an httpOnly cookie that names the token id, not the secret', async () => {
    const minted = await mintToken('test');
    const res = await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token: minted.token } }));
    expect(res.status).toBe(204);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).not.toContain(minted.token);
    const echoed = await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token: minted.token } }));
    // 204 — no body at all, so there is nowhere for the secret to ride back.
    expect(echoed.status).toBe(204);
    expect(await echoed.text()).toBe('');

    const session = await decodeAgentSession(cookieFrom(res));
    expect(session?.tokenIds).toEqual([minted.id]);
  });

  it('refuses an unknown or revoked token with a uniform 401', async () => {
    const unknown = await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token: 'mx_notarealtoken' } }));
    expect(unknown.status).toBe(401);
    expect(cookieFrom(unknown)).toBeNull();

    const minted = await mintToken('test');
    await revokeToken(minted.id);
    const revoked = await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token: minted.token } }));
    expect(revoked.status).toBe(401);
    expect(cookieFrom(revoked)).toBeNull();
  });

  it('accumulates tokens, newest last, so a browser can claim everything it minted', async () => {
    const first = await mintToken('one');
    const second = await mintToken('two');
    const a = await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token: first.token } }));
    const b = await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token: second.token }, cookie: cookieHeader(cookieFrom(a)) }));
    expect((await decodeAgentSession(cookieFrom(b)))?.tokenIds).toEqual([first.id, second.id]);

    // Re-presenting the first PROMOTES it: last touched authorizes the next write.
    const c = await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token: first.token }, cookie: cookieHeader(cookieFrom(b)) }));
    expect((await decodeAgentSession(cookieFrom(c)))?.tokenIds).toEqual([second.id, first.id]);
  });
});

describe('DELETE /api/session/token', () => {
  it('clears the cookie, so the browser stops being an owner', async () => {
    const res = await sessionDelete();
    const cleared = res.headers.get('set-cookie') ?? '';
    expect(cleared).toContain(`${AGENT_COOKIE}=;`);
    expect(cleared).toContain('Max-Age=0');
  });

  it('clears with the SAME attributes that set it — a `__Host-` cookie cannot be written without them', async () => {
    // Outside dev the cookie is `__Host-`-prefixed, and a browser REJECTS any
    // Set-Cookie for such a name that lacks Secure (or carries a non-/ Path).
    // A clear missing them is silently ignored: the session survives sign-out
    // and "Disconnect this browser" does nothing.
    const set = (await exchangeRoute(request('/api/session/token', { method: 'POST', json: { token: (await mintToken('t')).token } })))
      .headers.get('set-cookie') ?? '';
    const cleared = (await sessionDelete()).headers.get('set-cookie') ?? '';
    const attrs = (header: string) =>
      header.split(';').slice(1).map((a) => a.trim().split('=')[0]).filter((a) => a !== 'Max-Age').sort();
    expect(attrs(cleared)).toEqual(attrs(set));
  });
});

describe('the anonymous session as a credential', () => {
  it('is re-resolved per request: revoking the token ends it immediately', async () => {
    const minted = await mintToken('test');
    const cookie = cookieHeader(await encodeAgentSession({ tokenIds: [minted.id] }));

    const before = await listMine(request('/api/my/artifacts', { cookie: cookie }));
    expect(before.status).toBe(200);

    await revokeToken(minted.id);
    const after = await listMine(request('/api/my/artifacts', { cookie: cookie }));
    expect(after.status).toBe(401);
    expect(await resolveTokenById(minted.id)).toBeNull();
  });

  it('reaches only what its token created — token scope, not account scope', async () => {
    const mine = await mintToken('mine');
    const other = await mintToken('other');
    const ours = (await (await createArtifact(request('/api/artifacts', { method: 'POST', token: mine.token, json: { markup: '<h1>mine</h1>' } }))).json()) as { id: string };
    await createArtifact(request('/api/artifacts', { method: 'POST', token: other.token, json: { markup: '<h1>other</h1>' } }));

    const res = await listMine(request('/api/my/artifacts', { cookie: cookieHeader(await encodeAgentSession({ tokenIds: [mine.id] })) }));
    const body = (await res.json()) as { artifacts: Array<{ id: string }> };
    expect(body.artifacts.map((a) => a.id)).toEqual([ours.id]);
  });

  it('a tampered, truncated, or foreign-signed cookie is simply no session', async () => {
    const minted = await mintToken('test');
    const good = await encodeAgentSession({ tokenIds: [minted.id] });
    for (const bad of [good.slice(0, -4), `${good}x`, 'not-a-jwt', '']) {
      expect(await decodeAgentSession(bad)).toBeNull();
      expect((await listMine(request('/api/my/artifacts', { cookie: cookieHeader(bad) }))).status).toBe(401);
    }
  });
});

describe('Origin check', () => {
  it('rejects a cross-site cookie mutation, and never blocks a bearer agent call', async () => {
    const minted = await mintToken('test');
    const cookie = cookieHeader(await encodeAgentSession({ tokenIds: [minted.id] }));

    // A browser form/fetch from another site, riding the cookie.
    const crossSite = await createArtifact(request('/api/artifacts', { method: 'POST', cookie: cookie, origin: 'https://evil.example', json: { markup: '<h1>x</h1>' } }));
    expect(crossSite.status).toBe(403);

    // The same call from our own origin is ordinary.
    const sameSite = await createArtifact(request('/api/artifacts', { method: 'POST', cookie: cookie, origin: BASE, json: { markup: '<h1>x</h1>' } }));
    expect(sameSite.status).toBe(201);

    // An agent curling with a bearer sends NO Origin — the protocol must not care.
    const agent = await createArtifact(request('/api/artifacts', { method: 'POST', token: minted.token, json: { markup: '<h1>x</h1>' } }));
    expect(agent.status).toBe(201);
  });
});

describe('claiming what the browser holds', () => {
  it('offers and claims by token ID, from the cookie — no secret in the request', async () => {
    const user = await createUser({ email: 'claimer@example.com' });
    const first = await mintToken('one');
    const second = await mintToken('two');
    const made = (await (await createArtifact(request('/api/artifacts', { method: 'POST', token: first.token, json: { title: 'Held Doc', markup: '<h1>held</h1>' } }))).json()) as { id: string };

    const offers = await claimableTokensById(user.id, [first.id, second.id]);
    expect(offers.map((o) => o.tokenId).sort()).toEqual([first.id, second.id].sort());
    expect(offers.find((o) => o.tokenId === first.id)?.titles).toEqual(['Held Doc']);

    const claimed = await claimTokenById(user.id, first.id);
    expect(claimed).toEqual({ tokenId: first.id, claimedArtifacts: 1 });

    // The artifact now belongs to the account, and the token is no longer on offer.
    const row = await getArtifactFor({ tokenId: '', userId: user.id }, made.id);
    expect(row?.id).toBe(made.id);
    expect((await claimableTokensById(user.id, [first.id])).length).toBe(0);
  });

  it('never claims a token owned by someone else', async () => {
    const mine = await createUser({ email: 'mine@example.com' });
    const theirs = await createUser({ email: 'theirs@example.com' });
    const token = await mintToken('theirs');
    await claimTokenById(theirs.id, token.id);
    expect(await claimTokenById(mine.id, token.id)).toBeNull();
  });
});

describe('handing the document to another agent', () => {
  it('tells an ANONYMOUS owner to sign in, rather than minting a token that cannot reach the document', async () => {
    // A fresh anonymous token reaches only what IT created, and the original
    // is stored hashed — so there is no credential to hand over. Saying so is
    // better than handing out one that 404s on first use.
    const mine = await mintToken('mine');
    const doc = (await (await createArtifact(request('/api/artifacts', { method: 'POST', token: mine.token, json: { markup: '<h1>anon owned</h1>' } }))).json()) as { id: string };

    const cookie = cookieHeader(await encodeAgentSession({ tokenIds: [mine.id] }));
    const res = await agentPrompt(request(`/api/my/artifacts/${doc.id}/agent-prompt`, { method: 'POST', cookie: cookie, origin: BASE }), {
      params: Promise.resolve({ id: doc.id }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('sign_in_required');
  });

  it('returns a working existing-document prompt once the browser signs in and claims the token', async () => {
    const user = await createUser({ email: 'prompt@example.com' });
    const mine = await mintToken('mine');
    const doc = (await (await createArtifact(request('/api/artifacts', { method: 'POST', token: mine.token, json: { markup: '<h1>claimed</h1>' } }))).json()) as { id: string };
    await claimTokenById(user.id, mine.id);

    sessionUser.id = user.id;
    const res = await agentPrompt(request(`/api/my/artifacts/${doc.id}/agent-prompt`, { method: 'POST', origin: BASE }), {
      params: Promise.resolve({ id: doc.id }),
    });
    sessionUser.id = '';
    expect(res.status).toBe(201);
    const body = (await res.json()) as { prompt: string };
    expect(body.prompt).toBe(existingPaste(BASE, doc.id));

    // The account token the agent already holds reaches the claimed document.
    expect((await getArtifactFor({ tokenId: mine.id, userId: user.id }, doc.id))?.id).toBe(doc.id);
  });

  it('refuses a document this browser does not own', async () => {
    const mine = await mintToken('mine');
    const theirs = await mintToken('theirs');
    const doc = (await (await createArtifact(request('/api/artifacts', { method: 'POST', token: theirs.token, json: { markup: '<h1>not mine</h1>' } }))).json()) as { id: string };

    const res = await agentPrompt(request(`/api/my/artifacts/${doc.id}/agent-prompt`, { method: 'POST', cookie: cookieHeader(await encodeAgentSession({ tokenIds: [mine.id] })), origin: BASE }), { params: Promise.resolve({ id: doc.id }) });
    expect(res.status).toBe(404);
  });
});

describe('one viewer, every surface', () => {
  /*
   * Ownership and serving must resolve the SAME viewer. The proxy and the page
   * decide "owner" through sessionActor — NextAuth first, then the agent
   * cookie — so if a serving surface consults only NextAuth, a browser whose
   * cookie names a CLAIMED token (signed out, cookie still held) is an owner
   * upstairs and a stranger downstairs: the shell renders, and the private
   * document 404s inside its own frame.
   */
  it('a claimed token in the cookie reads its account-private document on every serving surface', async () => {
    const user = await createUser({ email: 'split@example.com' });
    const minted = await mintToken('mine');
    await claimTokenById(user.id, minted.id);
    const doc = (await (await createArtifact(request('/api/artifacts', { method: 'POST', token: minted.token, json: { markup: '<h1>SPLIT-VIEWER</h1>', visibility: 'private' } }))).json()) as { id: string };
    const cookie = cookieHeader(await encodeAgentSession({ tokenIds: [minted.id] }));

    const raw = await rawRoute(request(`/a/${doc.id}/raw`, { cookie: cookie }), { params: Promise.resolve({ id: doc.id }) });
    expect(raw.status, 'raw').toBe(200);
    expect(await raw.text()).toContain('SPLIT-VIEWER');

    // The live stream: the connect-time check and the per-wakeup re-check both
    // use this viewer, so an owner's watch must open (and a stranger's not).
    const events = await eventsRoute(request(`/a/${doc.id}/events`, { cookie: cookie }), { params: Promise.resolve({ id: doc.id }) });
    expect(events.status, 'events').toBe(200);
    await events.body?.cancel();

    // …and a browser with NO credential still gets the uniform 404 everywhere.
    for (const [name, res] of [
      ['raw', await rawRoute(request(`/a/${doc.id}/raw`), { params: Promise.resolve({ id: doc.id }) })],
      ['events', await eventsRoute(request(`/a/${doc.id}/events`), { params: Promise.resolve({ id: doc.id }) })],
    ] as const) {
      expect(res.status, `stranger ${name}`).toBe(404);
    }
  });

  it('the proxy serves that browser the SHELL for the same document — the two decisions agree', async () => {
    const user = await createUser({ email: 'split2@example.com' });
    const minted = await mintToken('mine');
    await claimTokenById(user.id, minted.id);
    const doc = (await (await createArtifact(request('/api/artifacts', { method: 'POST', token: minted.token, json: { markup: '<h1>x</h1>', visibility: 'private' } }))).json()) as { id: string };

    const cookie = cookieHeader(await encodeAgentSession({ tokenIds: [minted.id] }));
    const served = await servesDocumentDirectly(request(`/a/${doc.id}`, { cookie }));
    expect(served).toBeNull(); // the page (shell), not the document
  });
});

describe('the cookie is production-shaped wherever it is SERVED over https', () => {
  /*
   * The posture follows the SCHEME, not the environment: `__Host-` requires
   * Secure, and a browser rejects it over plain http — which is why the app
   * and the proxy that sets this cookie must ask the same question (see
   * __tests__/agent-cookie-name.test.ts, where they once did not).
   */
  it('is __Host- prefixed, Secure, httpOnly, SameSite=Lax, Path=/', async () => {
    vi.resetModules();
    vi.stubEnv('APP__PUBLIC_BASE_URL', 'https://artifactbin.dev');
    const { AGENT_COOKIE: name, agentCookieOptions } = await import('@/lib/agent-session');
    expect(name).toBe('__Host-mx-agent-session');
    // __Host- FORBIDS a Domain attribute and REQUIRES Secure + Path=/, so no
    // subdomain can plant or shadow it — the cookie-tossing defense the account
    // cookie's plain __Secure- prefix does not give.
    expect(agentCookieOptions()).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
