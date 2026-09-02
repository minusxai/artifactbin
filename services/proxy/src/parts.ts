/**
 * THE PROXY AS PARTS. One ordered literal — `proxyParts(o)` — is the whole
 * proxy: `session` resolves who is asking (bearer → the token reader; Better
 * Auth session; the agent cookie by id) and is the ONLY part that may touch
 * the actor; `rateLimit` is the doors (a deny is the proxy's ONLY own
 * verdict); `loginRoutes` is Better Auth behind the invite gate; `oauthRoutes`
 * the MCP OAuth provider; `forwardedHeaders` owns the forwarding headers
 * (x-mx-actor and x-real-ip dropped inbound, x-forwarded-{for,host,proto}
 * ours); `forward` is LAST — everything not matched above reaches the app
 * through the ONE upstream seam, the Request the app receives being the one
 * that arrived, never rebuilt.
 *
 * Nothing here signs anything in-process: the actor rides the Request
 * (utils attachActor inside `inProcess`; `signActor` only ever inside utils'
 * `overHttp`). Ownership of routes is POSITIONAL — `forward` last — so there
 * is no prefix list to drift.
 */
import {
  ACTOR_HEADER, ANONYMOUS, denyResponse, FORWARDED_FOR, FORWARDED_HOST, FORWARDED_PROTO,
  type Actor, type DoorName, type Limiter, type Part, type Queryable, type TokenReader, type Upstream,
} from '@artifactbin/contracts';
import { Hono, type Context } from 'hono';
import { assemble, cookieName, createCodeStore, createLimiter, decodeAgentSession, doorsEnv, memoryBackend, readCookie } from '@artifactbin/utils';
import { baseUrlOf, mountOAuthRoutes } from './routes/oauth';
import { createOAuthStore } from './identity/oauth';
import { readEnv } from './env';

/** What the session part resolves an account to. */
export interface SessionInfo { userId: string; email?: string; emailVerified?: boolean }

/**
 * Better Auth, as the parts see it: the session resolver for every request,
 * and (when login is mounted) the HTTP handler the loginRoutes part serves
 * under `/api/auth/*`. `handler` absent = no login surface on this proxy.
 */
export interface SessionStore {
  resolve(request: Request): Promise<SessionInfo | null>;
  handler?: (request: Request) => Promise<Response>;
}

export interface ProxyOptions {
  upstream: Upstream;
  env: Record<string, string | undefined>;
  /** The proxy's one read of the app-owned `tokens` table (utils createTokenReader). */
  tokens: TokenReader;
  /** Better Auth: session resolution (+ the login handler). */
  sessions: SessionStore;
  /**
   * ONLY for the split shape's `overHttp` upstream — passed to that adapter at
   * composition, never used by a part. Nothing in-process signs anything.
   */
  secret?: string;
  /** AUTH__SECRET — what reads (and only reads) the agent cookie. */
  cookieSecret: string;
  /** Cookies carry Secure (production / https). */
  secure?: boolean;
  /** The proxy's own OAuth tables; given = the OAuth routes mount. */
  identityDb?: Queryable;
  /** APP__SCHEMA as resolved by the composition; absent means the connection's default schema. */
  appSchema?: string;
  /**
   * Handshake deadline for `forward`: an upstream that refuses, or accepts and never answers, is a 502
   * `{ error: 'upstream_unavailable' }` inside this many ms — never a hang. Unset = no clock. The clock
   * stops at the handshake: a body that streams (an event feed) runs as long as it likes.
   */
  upstreamDeadlineMs?: number;
}

/** The context variables the parts share (Hono's `c.set`/`c.get`) — routes/oauth mounts on the same shape. */
export type ProxyEnv = { Variables: { actor: Actor; limiter: Limiter } };
export type ProxyApp = Hono<ProxyEnv>;

/** Which door a request opens, by route. LOGIN_SEND is keyed by the EMAIL in the body — applied in loginRoutes. */
export function doorFor(method: string, pathname: string): DoorName | null {
  if (pathname === '/api/tokens/anonymous' || pathname === '/api/start') return 'ANON_MINT';
  if (pathname.startsWith('/api/auth/sign-in') || pathname.startsWith('/api/auth/email-otp/verify')) return 'LOGIN_VERIFY';
  if (pathname === '/oauth/register') return 'OAUTH_REGISTER';
  if (pathname === '/oauth/token') return 'OAUTH_TOKEN';
  if (/^\/a\/[A-Za-z0-9]+\/mutate$/.test(pathname)) return 'MUTATE';
  if (/^\/a\/[A-Za-z0-9]+\/query$/.test(pathname) || pathname === '/api/query') return 'QUERY';
  if (/^\/a\/[A-Za-z0-9]+\/export$/.test(pathname)) return 'EXPORT';
  if (/\/edits$/.test(pathname)) return 'EDIT';
  if (method !== 'GET' && method !== 'HEAD' && (pathname.startsWith('/api/artifacts') || pathname.startsWith('/api/my/artifacts') || pathname === '/mcp')) return 'PUBLISH';
  return null;
}

/** How many hops in front of this proxy are ours (`RATE_LIMITER__TRUSTED_PROXY_HOPS`). Default 0: we are the outermost, and nothing inbound is believed. */
export function trustedHopsOf(env: Record<string, string | undefined>): number {
  const raw = readEnv(env, 'RATE_LIMITER__TRUSTED_PROXY_HOPS');
  const n = Math.trunc(Number(raw ?? '0'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The peer this hop received from — the socket when there is one, `unknown` in-process (no socket to ask). */
export function peerIpOf(c: Context): string {
  const info = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress;
  return info ?? 'unknown';
}

/**
 * WHERE THE DOORS KEY. `X-Forwarded-For` is a list each hop APPENDS to, so
 * behind `trustedHops` trusted hops the client's address as our own trusted
 * infrastructure observed it sits `trustedHops` from the END of the inbound
 * chain (clamped at the front, so a short list cannot walk onto a
 * caller-supplied entry). With no trusted hop — or no chain — the bucket is
 * this hop's peer: an untrusted hop's IP, never a value the caller typed.
 * (P4 finding F2: over a hop with no XFF appended, every caller would share
 * the outer proxy's IP and the door's MAX becomes a global ceiling.)
 */
export function clientIpOf(headers: Headers, trustedHops: number, peer: string): string {
  if (trustedHops > 0) {
    const forwarded = headers.get(FORWARDED_FOR);
    if (forwarded) {
      const chain = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
      const hop = chain[Math.max(0, chain.length - trustedHops)];
      if (hop !== undefined) return hop;
    }
  }
  return peer;
}

/** ONE limiter per options object — the session part's `c.set('limiter')` and the rateLimit part's doors are the same counters. */
const limiters = new WeakMap<ProxyOptions, Limiter>();
const limiterFor = (o: ProxyOptions): Limiter => {
  let l = limiters.get(o);
  if (!l) { l = createLimiter({ backend: memoryBackend(), env: doorsEnv(o.env) }); limiters.set(o, l); }
  return l;
};

/** THE SESSION PART — resolve who is asking, ONCE, before anything else runs; the ONLY part that touches the actor. */
export function session(o: ProxyOptions): Part<ProxyEnv> {
  return {
    name: 'session',
    mount: (app) => app.use('*', async (c, next) => {
      c.set('limiter', limiterFor(o));
      c.set('actor', await resolveActor(c.req.raw, o));
      await next();
    }),
  };
}

/** THE DOORS — a deny is the proxy's ONLY own verdict; everything else the app answers. */
export function rateLimit(o: ProxyOptions): Part<ProxyEnv> {
  return {
    name: 'rateLimit',
    mount: (app) => app.use('*', async (c, next) => {
      const door = doorFor(c.req.method, new URL(c.req.url).pathname);
      if (door) {
        const actor = (c.get('actor') as Actor) ?? ANONYMOUS;
        const trustedHops = trustedHopsOf(o.env);
        const ip = clientIpOf(c.req.raw.headers, trustedHops, peerIpOf(c));
        const decision = await limiterFor(o).limit(door, {
          ip,
          actorId: actor.userId ?? actor.tokenId ?? null,
          holder: actor.credential !== 'none',
        });
        if (!decision.allowed) return denyResponse({ error: 'rate_limited', retryAfter: decision.retryAfter, door });
      }
      await next();
    }),
  };
}

/** LOGIN — Better Auth's handler, behind the LOGIN_SEND door keyed by the ADDRESS the code goes to. */
export function loginRoutes(o: ProxyOptions): Part<ProxyEnv> {
  return {
    name: 'loginRoutes',
    mount: (app) => {
      const a = app;
      a.post('/api/auth/email-otp/send-verification-otp', async (c, next) => {
        const body = await c.req.raw.clone().json().catch(() => null) as { email?: unknown } | null;
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!email) return c.json({ error: 'email_invalid' }, 400);
        const trustedHops = trustedHopsOf(o.env);
        const decision = await limiterFor(o).limit('LOGIN_SEND', { ip: clientIpOf(c.req.raw.headers, trustedHops, peerIpOf(c)), actorId: email });
        if (!decision.allowed) return denyResponse({ error: 'rate_limited', retryAfter: decision.retryAfter, door: 'LOGIN_SEND' });
        await next();
      });
      if (o.sessions.handler) a.all('/api/auth/*', (c) => o.sessions.handler!(c.req.raw));
    },
  };
}

/** THE MCP OAUTH PROVIDER — /oauth/* and /.well-known/*, over the proxy's own `auth` schema; mounted only when identityDb is given. */
export function oauthRoutes(o: ProxyOptions): Part<ProxyEnv> {
  return {
    name: 'oauthRoutes',
    mount: (app) => {
      if (!o.identityDb) return;
      const schema = readEnv(o.env, 'AUTH__SCHEMA') ?? 'auth';
      const appSchema = o.appSchema ?? readEnv(o.env, 'APP__SCHEMA');
      const codes = createCodeStore(o.identityDb, { schema });
      mountOAuthRoutes(app, {
        codes,
        oauth: createOAuthStore(o.identityDb, schema, appSchema),
        upstream: o.upstream,
        trustedHops: trustedHopsOf(o.env),
        publicBaseUrl: readEnv(o.env, 'APP__PUBLIC_BASE_URL'),
      });
    },
  };
}

/**
 * THE LITERAL, in order — the readable truth about middleware order. `forward`
 * is LAST: ownership of routes is positional, so anything an earlier part
 * matched never reaches it (the replacement for the old hand-kept prefix
 * list). A downstream replaces a part BY NAME through utils' `assemble`.
 */
export function proxyParts(o: ProxyOptions): Part<ProxyEnv>[] {
  return [session(o), rateLimit(o), loginRoutes(o), oauthRoutes(o), forwardedHeaders({ trustedHops: trustedHopsOf(o.env), ...(o.secure ? { secure: true } : {}) }), forward(o.upstream, o)];
}

/** The proxy, assembled from its parts. */
export const createProxy = (o: ProxyOptions): ProxyApp => assemble(proxyParts(o));

/** Who is asking — bearer first, then the account session, then the agent cookie. Absent or invalid → `none`. */
async function resolveActor(request: Request, o: ProxyOptions): Promise<Actor> {
  const auth = request.headers.get('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (presented) {
    const token = await o.tokens.byToken(presented);
    if (token && tokenFitsRequest(token, request, o)) return { credential: 'bearer', tokenId: token.id, ...(token.userId ? { userId: token.userId } : {}) };
    return ANONYMOUS;
  }
  const secure = o.secure ?? false;
  const held = decodeAgentSession(readCookie(request.headers.get('cookie'), cookieName(secure)), o.cookieSecret);
  const heldIds = held?.tokenIds.length ? { heldTokenIds: held.tokenIds } : {};
  const session = await o.sessions.resolve(request).catch(() => null);
  if (session) {
    return {
      credential: 'session',
      userId: session.userId,
      ...(session.email ? { email: session.email } : {}),
      ...(session.emailVerified !== undefined ? { emailVerified: session.emailVerified } : {}),
      ...heldIds,
    };
  }
  const lastHeld = held?.tokenIds[held.tokenIds.length - 1];
  if (lastHeld !== undefined) {
    const token = await o.tokens.byId(lastHeld);
    if (token && tokenFitsRequest(token, request, o)) return { credential: 'agent-cookie', tokenId: token.id, ...(token.userId ? { userId: token.userId } : {}), ...heldIds };
  }
  return ANONYMOUS;
}

/** OAuth access tokens are capabilities for one exact MCP resource and scope. */
function tokenFitsRequest(token: { audience?: string; scope?: string }, request: Request, o: ProxyOptions): boolean {
  if (!token.audience) return true;
  const origin = baseUrlOf(request, trustedHopsOf(o.env), readEnv(o.env, 'APP__PUBLIC_BASE_URL'));
  const target = `${origin}${new URL(request.url).pathname}`;
  return token.audience === target && (token.scope?.split(/\s+/).includes('artifacts') ?? false);
}

/**
 * The last part: every request not answered above goes to the upstream with the actor the session part
 * resolved. The Request passes through unchanged when there is no deadline. With a deadline, a signal-linked
 * derivative lets the HTTP adapter abort a stalled HANDSHAKE while preserving the caller's abort; the clock is
 * cleared as soon as the response head arrives, so a streaming body is never cut. Any unavailable upstream,
 * including a refused connection with no deadline configured, has one 502 response.
 */
export function forward(upstream: Upstream, o?: ProxyOptions): Part<ProxyEnv> {
  return {
    name: 'forward',
    mount: (app) => app.all('*', async (c) => {
      const incoming = c.req.raw;
      const deadline = o?.upstreamDeadlineMs;
      const controller = deadline !== undefined && Number.isFinite(deadline) && deadline > 0
        ? new AbortController()
        : null;
      const timer = controller
        ? setTimeout(() => controller.abort(new Error('upstream handshake deadline exceeded')), deadline)
        : null;
      const request = controller
        ? new Request(incoming, { signal: AbortSignal.any([incoming.signal, controller.signal]) })
        : incoming;
      try {
        return await upstream(request, (c.get('actor') as Actor) ?? ANONYMOUS);
      } catch {
        return c.json({ error: 'upstream_unavailable' }, 502);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  };
}

/**
 * THE FORWARDING HEADERS, owned here and nowhere else (P4 findings F1/F2):
 *  - `x-mx-actor` and `x-real-ip` are the CALLER's claims about who is asking
 *    — dropped inbound, always. The actor rides the Request.
 *  - OUTERMOST (`trustedHops: 0`): `x-forwarded-host`/`proto` are SET from
 *    what this hop actually received — the app builds absolute URLs from them
 *    (a document's CSP, every link it publishes), so an inbound value is a
 *    caller choosing the origin. `x-forwarded-for` is this hop's peer.
 *  - BEHIND A TRUSTED HOP (`trustedHops ≥ 1`): host/proto the trusted hop set
 *    are PRESERVED (it is where the client thinks it is); our peer is APPENDED
 *    to the chain, the standard XFF rule, so a hop walking back `trustedHops`
 *    lands on the client as the trusted chain recorded it.
 *
 * The headers are MUTATED IN PLACE on `c.req.raw` — never a rebuilt Request.
 */
export function forwardedHeaders(o: { trustedHops: number; secure?: boolean }): Part<ProxyEnv> {
  return {
    name: 'forwardedHeaders',
    mount: (app) => app.use('*', async (c, next) => {
      const h = c.req.raw.headers;
      const url = new URL(c.req.url);
      const peer = peerIpOf(c);
      h.delete(ACTOR_HEADER);
      h.delete('x-real-ip');
      const host = h.get('host') ?? url.host;
      const proto = o.secure ? 'https' : url.protocol.replace(':', '');
      if (o.trustedHops > 0) {
        const inboundFor = h.get(FORWARDED_FOR);
        h.set(FORWARDED_FOR, inboundFor ? `${inboundFor}, ${peer}` : peer);
        if (!h.get(FORWARDED_HOST)) h.set(FORWARDED_HOST, host);
        if (!h.get(FORWARDED_PROTO)) h.set(FORWARDED_PROTO, proto);
      } else {
        h.set(FORWARDED_FOR, peer);
        h.set(FORWARDED_HOST, host);
        h.set(FORWARDED_PROTO, proto);
      }
      await next();
    }),
  };
}
