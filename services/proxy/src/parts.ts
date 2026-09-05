/**
 * THE PROXY AS PARTS. One ordered literal — `proxyParts(o)` — is the whole
 * proxy: `session` resolves who is asking (bearer → the token reader; Better
 * Auth session; the agent cookie by id) and is the ONLY part that may touch
 * the actor; `rateLimit` is the WHOLE of the rate limiting — the policy file's
 * verdict on every request, the browser-only refusal included (it is asked
 * BEFORE anything is counted, because a refusal must not spend the per-IP
 * budget its own advice sends the human back to use); `loginRoutes` is Better Auth behind the invite gate; `oauthRoutes`
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
  ACTOR_HEADER, AGENT_HEADER, ANONYMOUS, declaredAgentSlug, denyResponse, FORWARDED_FOR, FORWARDED_HOST, FORWARDED_PROTO,
  type Actor, type EventsService, type Part, type Queryable, type TokenReader, type Upstream,
} from '@artifactbin/contracts';
import type { RateLimiter } from '@artifactbin/contracts/rate-limits';
import { Hono, type Context } from 'hono';
import { assemble, cookieName, decodeAgentSession, readCookie } from '@artifactbin/utils';
import { createRateLimiter, memoryBackend } from '@artifactbin/utils/rate-limits';
import { loadPolicyFile, resolvePolicyFilePath } from './rate-limits';
import { baseUrlOf, mountOAuthRoutes } from './routes/oauth';
import { say, type ProxySubject } from './events';
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
  /**
   * Where the proxy SAYS what happened — a door's denial, a login code sent — in the log's own sentences
   * (services/events). Absent = a noop: nothing leaves the box. The in-process composition hands the app's
   * writer; the standalone one an HTTP client to EVENTS__SERVICE_URL. Never awaited on a request's path.
   */
  events?: EventsService;
}

/** The context variables the parts share (Hono's `c.set`/`c.get`) — routes/oauth mounts on the same shape. */
export type ProxyEnv = { Variables: { actor: Actor; limiter: RateLimiter } };
export type ProxyApp = Hono<ProxyEnv>;

/**
 * IS THIS A REAL BROWSER? MEASURED on production: Chromium on `/tokens/new` sends
 * `origin: <this origin>` and `sec-fetch-site: same-origin` on the mint fetch, and both survive this
 * proxy to the upstream untouched. A bare HTTP client sends neither. The anonymous mint is the ONLY
 * door this guards — `/api/start` shares its rate-limit door and is posted by agents with no browser.
 *
 * HOSTS are compared, not whole origins: behind TLS termination the browser says
 * `origin: https://artifactbin.dev` while this hop's own request arrived over `http`, so full-origin
 * equality would refuse the product's own page. `sec-fetch-site` is Fetch Metadata — the browser sets it and
 * page JavaScript cannot — so its ABSENCE is the reliable half of the signal.
 *
 * SEVERAL hosts may be ours, and that is the difference between a door and an outage: an instance reached on
 * `127.0.0.1` when `APP__PUBLIC_BASE_URL` says `localhost` (or on any alternate/preview hostname) would
 * otherwise refuse its OWN page, and the only symptom a person sees is "Could not generate a token".
 *
 * Honestly: this is not a security boundary. Any client can type these two headers, and one that does gets
 * through. It is a door that TEACHES — it catches the agent mid-mistake and hands it the ladder — while the
 * real fix is that no agent-facing surface names this address any more (app `lib/agent-contract`).
 */
export function isBrowserContext(headers: Headers, origin: string | readonly string[]): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== 'same-origin' && site !== 'same-site') return false;
  const declared = headers.get('origin');
  if (!declared) return false;
  const from = hostOf(declared);
  const ours = (typeof origin === 'string' ? [origin] : origin).map(hostOf).filter((h): h is string => h !== null);
  return from !== null && ours.includes(from);
}

const hostOf = (value: string): string | null => {
  try { return new URL(value).host.toLowerCase(); } catch { return null; }
};

/**
 * THE REFUSAL THAT TEACHES. An agent at this door is mid-mistake and it is the best teaching moment we get,
 * so the body IS the ladder rather than a bare "no": the plugin/MCP first, then the human's own door — SOURCE-
 * TAGGED from `Artifactbin-Agent` when it names a harness we know, so the person who is asked for a token
 * lands on a page that knows who sent them.
 *
 * THIS IS THE `browser_only` BODY, and it stays in OSS code verbatim: the policy file only says WHICH routes
 * carry the flag, never what the refusal says.
 *
 * 403, deliberately. The request is well formed and understood, and no credential the caller could add would
 * change the answer — which is exactly what 401 would invite it to go and try (and trying is the failure).
 * 404 would lie about a route the browser uses, and 429 would claim a rate limit that has not been hit.
 */
export function anonMintRefusal(origin: string, agentHeader: string | null): Response {
  const source = declaredAgentSlug(agentHeader);
  const tokens = `${origin}/tokens/new${source ? `?source=${source}` : ''}`;
  return new Response(JSON.stringify({
    error: 'browser_only',
    reason: 'This endpoint is the web page\'s own mint. An agent that mints its own token publishes documents its human cannot reach.',
    ladder: [
      'If the artifactbin plugin or MCP server is available, use it — that connection is already authenticated and needs no token.',
      `Otherwise check ~/.artifactbin.env for ARTIFACTBIN_TOKEN.`,
      `Otherwise STOP and ask your human for a token at ${tokens} — do not mint one yourself.`,
    ],
    tokens,
    docs: `${origin}/docs/artifactbin/references/publishing-auth.md`,
  }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
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

/**
 * WHO THE LOG NAMES when a door refuses. An account if we resolved one, else
 * the bearer token that was presented, else nobody — never an IP and never an
 * email: those identify a PERSON, and a refusal is not one of the identity
 * moments where the catalogue lets an address travel.
 */
const subjectOf = (actor: Actor | undefined): ProxySubject | null => {
  if (actor?.userId) return { kind: 'user', id: actor.userId };
  if (actor?.tokenId) return { kind: 'token', id: actor.tokenId };
  return null;
};

/**
 * ONE limiter per options object, built the FIRST time `proxyParts` composes them — which is boot. The
 * policy file is read, parsed and validated exactly once there, so a missing file, an unparseable one or an
 * unknown policy name REFUSES TO BOOT instead of meeting a request with built-in numbers nobody chose.
 */
const limiters = new WeakMap<ProxyOptions, RateLimiter>();
const limiterFor = (o: ProxyOptions): RateLimiter => {
  let l = limiters.get(o);
  if (!l) {
    l = createRateLimiter({ file: loadPolicyFile(resolvePolicyFilePath(o.env)), backend: memoryBackend() });
    limiters.set(o, l);
  }
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

/**
 * THE RATE LIMITS — the proxy's ONE enforcement point, and the only place in the product that counts a
 * request. Everything about WHICH limits apply where is the policy file; this part only translates HTTP into
 * an `Identity` and a `Decision` into a response, in three beats:
 *
 *  1. `browser_only` — asked BEFORE anything is counted, so the refusal never spends the budget its own
 *     advice sends the human back to use. The body is `anonMintRefusal`, unchanged, owned here.
 *  2. an `email`-keyed policy needs the address the code would go to — read from the JSON body, lowercased;
 *     no address is 400 `email_invalid`, on ANY such route rather than the one login handler that used to
 *     do it by hand.
 *  3. the verdict: `always` then the route's policies, and a refusal is a 429 naming the POLICY.
 */
export function rateLimit(o: ProxyOptions): Part<ProxyEnv> {
  return {
    name: 'rateLimit',
    mount: (app) => app.use('*', async (c, next) => {
      const limiter = limiterFor(o);
      const request = { method: c.req.method, url: c.req.url };
      const trustedHops = trustedHopsOf(o.env);
      if (limiter.browserOnly(request)) {
        // What we CALL ourselves, and what this request actually reached us on — a browser on either is ours.
        const configured = baseUrlOf(c.req.raw, trustedHops, readEnv(o.env, 'APP__PUBLIC_BASE_URL'));
        const observed = baseUrlOf(c.req.raw, trustedHops);
        if (!isBrowserContext(c.req.raw.headers, [configured, observed])) {
          return anonMintRefusal(configured, c.req.raw.headers.get(AGENT_HEADER));
        }
      }
      let email: string | null = null;
      if (limiter.needsEmail(request)) {
        const body = await c.req.raw.clone().json().catch(() => null) as { email?: unknown } | null;
        email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!email) return c.json({ error: 'email_invalid' }, 400);
      }
      const actor = (c.get('actor') as Actor) ?? ANONYMOUS;
      const decision = await limiter.check(request, {
        ip: clientIpOf(c.req.raw.headers, trustedHops, peerIpOf(c)),
        actorId: actor.userId ?? actor.tokenId ?? null,
        holder: actor.credential !== 'none',
        url: c.req.url,
        ...(email ? { email } : {}),
      });
      if (!decision.allowed) {
        void say(o.events, subjectOf(actor), 'denied', { kind: 'door', id: decision.door }, { door: decision.door });
        return denyResponse({ error: 'rate_limited', retryAfter: decision.retryAfter, door: decision.door });
      }
      await next();
    }),
  };
}

/**
 * LOGIN — Better Auth's handler, and the ONE sentence the proxy says about it. The rate limit that used to
 * live here — one door keyed by the address, counted by hand — is gone: it is the `login_send` policy on
 * this route in the file, keyed `email`, and `rateLimit` has already refused or admitted the request — the
 * 400 for a body with no address included — by the time this part is reached.
 */
export function loginRoutes(o: ProxyOptions): Part<ProxyEnv> {
  return {
    name: 'loginRoutes',
    mount: (app) => {
      const a = app;
      a.post('/api/auth/email-otp/send-verification-otp', async (c, next) => {
        const body = await c.req.raw.clone().json().catch(() => null) as { email?: unknown } | null;
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        await next();
        /*
         * A CODE IS OUT. Said only once the rate limit allowed AND Better Auth
         * answered 2xx — a 400 (no address) or a 429 is not a code, and the
         * 429 has already said `door.denied` instead. The ADDRESS is the
         * object: at this step there is no account yet, so the address is the
         * only identity the moment has, and the catalogue admits it on the
         * identity verbs for exactly that reason.
         */
        if (email && c.res.status >= 200 && c.res.status < 300) {
          void say(o.events, null, 'login_sent', { kind: 'user', id: email }, { email });
        }
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
      mountOAuthRoutes(app, {
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
  // The limiter is built HERE, at composition — a policy file that does not exist or does not parse is a
  // refusal to boot, never a request quietly metered by numbers nobody chose.
  limiterFor(o);
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
