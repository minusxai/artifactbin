/** Shared identity and login boundary. No proxy transport or rate policy. */
import {REVALIDATE_ACTOR_HEADER, ANONYMOUS, isInternalApiPath, type Actor, type EventsService, type Part, type Queryable, type TokenReader, type Upstream} from '@artifactbin/contracts';
import type {Hono} from 'hono';
import {assemble,cookieName,decodeAgentSession,readCookie,buildAssetRequest,buildAssetResponse} from '@artifactbin/utils';
import {baseUrlOf,mountOAuthRoutes} from './routes/oauth';
import {say} from './events';
import {createDevicePairing} from './identity/device-pairing';
import {createOAuthStore} from './identity/oauth';
import {readEnv} from './env';
import {createAgentBrowserSessions} from './auth/agent-browser-session';
export interface SessionInfo {userId:string;email?:string;emailVerified?:boolean}
export interface SessionStore {
 identity?(userId:string):Promise<SessionInfo|null>;
 resolve(request:Request):Promise<SessionInfo|null>;
 handler?:(request:Request)=>Promise<Response>;
}
export interface AuthOptions {
 upstream:Upstream;
 env:Record<string,string|undefined>;
 tokens:TokenReader;
 sessions:SessionStore;
 cookieSecret:string;
 secure?:boolean;
 identityDb?:Queryable;
 appSchema?:string;
 events?:EventsService;
 /** Private deployments may explicitly trust their preceding transport. OSS leaves this zero. */
 trustedHops?:number;
}
export type AuthEnv={Variables:{actor:Actor}};
export type AuthApp=Hono<AuthEnv>;
const agentBrowsers = new WeakMap<AuthOptions, ReturnType<typeof createAgentBrowserSessions>>();
const agentBrowserOf = (o:AuthOptions) => {
  if(!o.identityDb)return null;
  let browser=agentBrowsers.get(o);
  if(!browser){browser=createAgentBrowserSessions(o.identityDb,readEnv(o.env,'AUTH__SCHEMA')??'auth');agentBrowsers.set(o,browser);}
  return browser;
};

export function session(o: AuthOptions): Part<AuthEnv> {
  return {
    name: 'session',
    mount: (app) => app.use('*', async (c, next) => {
      const admitted=await resolveActor(c.req.raw, o);
      const heldOwners = admitted.credential === 'session' && admitted.emailVerified
        ? await Promise.all((admitted.heldTokenIds ?? []).map(id => o.tokens.byId(id))) : [];
      c.set('actor', admitted);
      await next();
      // The app can merge guest ownership after verified login. Clear cached
      // CLI identities on this transition; subsequent requests see matching owners.
      if (heldOwners.some(token => token?.userId && token.userId !== admitted.userId)) o.tokens.invalidate();
      if(c.res.headers.has(REVALIDATE_ACTOR_HEADER)) {
        const headers=new Headers(c.res.headers);headers.delete(REVALIDATE_ACTOR_HEADER);
        c.res=new Response(c.res.body,{status:c.res.status,statusText:c.res.statusText,headers});
        // Hono's response setter merges prior headers into the replacement.
        c.res.headers.delete(REVALIDATE_ACTOR_HEADER);
        if(admitted.credential!=='none') {
          // The app receives an actor snapshot, not our session cookie store.
          // Revalidate here, AFTER SQL/cache waits and before releasing rows,
          // identically for in-process and HTTP upstreams. Never query auth
          // tables from the app or pretend its attached snapshot is live.
          let current:Actor=ANONYMOUS;
          try {if(admitted.tokenId)o.tokens.invalidate(admitted.tokenId);current=await resolveActor(c.req.raw,o);} catch { /* fail closed */ }
          const identity=(actor:Actor)=>[actor.credential,actor.userId,actor.tokenId,actor.email,actor.emailVerified];
          if(JSON.stringify(identity(current))!==JSON.stringify(identity(admitted))) {
            await c.res.body?.cancel().catch(()=>{});
            c.res=new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers:{'content-type':'application/json','cache-control':'no-store'}});
            // Hono merges old headers into replacements. These describe the
            // discarded upstream body, not this uncompressed JSON refusal.
            c.res.headers.delete('content-length');
            c.res.headers.delete('content-encoding');
            c.res.headers.delete(REVALIDATE_ACTOR_HEADER);
          }
        }
      }
      const browser=agentBrowserOf(o);
      if(!browser)return;
      const name=cookieName(o.secure??false);
      const previous=decodeAgentSession(readCookie(c.req.raw.headers.get('cookie'),name),o.cookieSecret);
      const changes=c.res.headers.getSetCookie().filter(value=>value.startsWith(name+'='));
      if(changes.length!==1)return;
      const pair=changes[0]!.split(';')[0]!,value=pair.slice(name.length+1);
      if(previous?.sessionId)await browser.revoke(previous.sessionId);
      if(!value)return;
      const nextSession=decodeAgentSession(value,o.cookieSecret),primary=nextSession?.tokenIds.at(-1);
      if(!nextSession?.sessionId||!primary){c.res.headers.append('set-cookie',`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${o.secure?'; Secure':''}`);return;}
      o.tokens.invalidate(primary);
      if(!await o.tokens.byId(primary)){c.res.headers.append('set-cookie',`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${o.secure?'; Secure':''}`);return;}
      await browser.issue(nextSession.sessionId,primary);
    }),
  };
}


export function internalBoundary(): Part<AuthEnv> {
  return {
    name: 'internalBoundary',
    mount: (app) => app.use('*', async (c, next) => {
      if (isInternalApiPath(new URL(c.req.url).pathname)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        });
      }
      await next();
    }),
  };
}

/** Serve the existing human login handler and record successful code delivery. */
export function loginRoutes(o: AuthOptions): Part<AuthEnv> {
  return {
    name: 'loginRoutes',
    mount: (app) => {
      const a = app;
      a.post('/api/auth/email-otp/send-verification-otp', async (c, next) => {
        const body = await c.req.raw.clone().json().catch(() => null) as { email?: unknown } | null;
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        await next();
        if (email && c.res.status >= 200 && c.res.status < 300) {
          void say(o.events, null, 'login_sent', { kind: 'user', id: email }, { email });
        }
      });
      if (o.sessions.handler) a.all('/api/auth/*', (c) => o.sessions.handler!(c.req.raw));
    },
  };
}

/** Device OAuth and discovery use the same identity database as human sessions. */
export function oauthRoutes(o: AuthOptions): Part<AuthEnv> {
  return {
    name: 'oauthRoutes',
    mount: (app) => {
      if (!o.identityDb) return;
      const schema = readEnv(o.env, 'AUTH__SCHEMA') ?? 'auth';
      const appSchema = o.appSchema ?? readEnv(o.env, 'APP__SCHEMA');
      mountOAuthRoutes(app, {
        oauth: createOAuthStore(o.identityDb, schema, appSchema),
        pairing: createDevicePairing(o.identityDb, schema),
        upstream: o.upstream,
        trustedHops: o.trustedHops ?? 0,
        publicBaseUrl: readEnv(o.env, 'APP__PUBLIC_BASE_URL'),
      });
    },
  };
}


export function publicBuildAssets(o: AuthOptions): Part<AuthEnv> {
  return {
    name: 'publicBuildAssets',
    mount: app => app.use('*', async (c, next) => {
      const request = buildAssetRequest(c.req.raw);
      if (!request) return next();
      try {
        const response = await o.upstream(request, ANONYMOUS);
        const safe = buildAssetResponse(response);
        if (safe) return safe;
        await response.body?.cancel();
      } catch {
        // Never turn an unverified response into public bytes; the normal
        // forwarding path retains its own availability and access behavior.
      }
      return next();
    }),
  };
}


async function resolveActor(request: Request, o: AuthOptions): Promise<Actor> {
  const auth = request.headers.get('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (presented) {
    const token = await o.tokens.byToken(presented);
    if (token && tokenFitsRequest(token, request, o)) {
      const actor: Actor = { credential: 'bearer', tokenId: token.id, ...(token.userId ? { userId: token.userId } : {}) };
      const identity = token.userId ? await o.sessions.identity?.(token.userId).catch(() => null) : null;
      return identity?.userId === token.userId && identity
        ? {...actor, email: identity.email, emailVerified: identity.emailVerified}
        : actor;
    }
    return ANONYMOUS;
  }
  const secure = o.secure ?? false;
  let held = decodeAgentSession(readCookie(request.headers.get('cookie'), cookieName(secure)), o.cookieSecret);
  const browser=agentBrowserOf(o),heldPrimary=held?.tokenIds.at(-1);
  if(browser&&(!held?.sessionId||!heldPrimary||!await browser.live(held.sessionId,heldPrimary)))held=null;
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

/** OAuth access tokens are capabilities for one API origin and scope. */
function tokenFitsRequest(token: { audience?: string; scope?: string }, request: Request, o: AuthOptions): boolean {
  if (!token.audience) return true;
  const origin = baseUrlOf(request, o.trustedHops ?? 0, readEnv(o.env, 'APP__PUBLIC_BASE_URL'));
  const path = new URL(request.url).pathname;
  return (path === '/api' || path.startsWith('/api/')) && token.audience === `${origin}/api` && (token.scope?.split(/\s+/).includes('artifacts') ?? false);
}


export function authParts(o:AuthOptions):Part<AuthEnv>[] {
 return [publicBuildAssets(o),session(o),internalBoundary(),loginRoutes(o),oauthRoutes(o),{name:'application',mount:app=>app.all('*',c=>o.upstream(c.req.raw,c.get('actor')))}];
}
export const createAuthHost=(o:AuthOptions):AuthApp=>assemble(authParts(o));
