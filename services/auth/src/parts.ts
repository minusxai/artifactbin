/** Shared identity and login boundary. No proxy transport or rate policy. */
import {CODE_DELIVERY_HEADER} from '@artifactbin/contracts/cli-auth';
import {REVALIDATE_ACTOR_HEADER, ANONYMOUS, isGroupActor, isGroupActorRole, type Actor} from '@artifactbin/contracts/actor';
import {IDENTITY_SCHEMA} from '@artifactbin/contracts/identity-service';
import {isInternalApiPath} from '@artifactbin/contracts/routes';
import {parseAliasOrigins} from '@artifactbin/contracts/server-identity';
import {parseServiceAudiences, type ServiceAudience} from '@artifactbin/contracts/service-audiences';
import type {EventsService} from '@artifactbin/contracts/events';
import type {Part, Upstream} from '@artifactbin/contracts/part';
import type {Queryable} from '@artifactbin/contracts/db';
import type {TokenReader} from '@artifactbin/contracts/identity';
import type {TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import type {Env, Hono} from 'hono';
import {BodyTooLargeError, readBody} from '@artifactbin/utils/body';
import {assemble} from '@artifactbin/utils/assemble';
import {buildAssetRequest, buildAssetResponse} from '@artifactbin/utils/build-assets';
import {attachActor, actorOf} from '@artifactbin/utils/upstream';
import {mountOAuthRoutes} from './routes/oauth';
import {acceptedOriginsOf,baseUrlOf,AUTH_BODY_LIMIT,payloadTooLarge,type GroupSignIns} from './routes/grants';
import {say} from './events';
import {sessionAuthority} from './session-authority';
import {groupServiceTokenKey,serviceTokenKey} from './identity/service-tokens';
import {readLiveGroupSignIn} from './identity/bearer';
import {ACCESS_TOKEN_TTL_SECONDS,createOAuthStore,parseOAuthClients} from './identity/oauth';
import {mintGroupSignIn} from './identity-store/accounts';
import {groupLevelHeldSql} from './identity-store/rules';
import {identityTables} from './identity-store/tables';
import {readEnv} from './env';
import {usesDevOutbox} from './mail';
import {TRUSTED_SIGNIN_PATH,createTrustedTokenVerifier,joinsCompanyRoot,trustedCallbackPath,trustedEmailOf,trustedIssuersOf} from './identity/trusted-issuers';
import {trustedSignIn} from './identity-store/trusted-sign-in';
/** `setCookies`: Set-Cookie values the store wants sent back (a rolled-forward session cookie). */
export interface SessionInfo {sessionId?:string;userId:string;email?:string;emailVerified?:boolean;setCookies?:string[];
 /** Set only by trusted-issuer sign-in, after the token verified: the issuer vouches for the person (see `admitIdentity`). */
 trustedIssuer?:string}
export interface SessionStore {
 identity?(userId:string):Promise<SessionInfo|null>;
 resolve(request:Request):Promise<SessionInfo|null>;
 live?:(sessionId:string,userId:string)=>Promise<boolean>;
 handler?:(request:Request)=>Promise<Response>;
 /** A new session for an account already established and admitted (trusted-issuer sign-in): its Set-Cookie values. */
 start?:(userId:string)=>Promise<string[]>;
}
export interface AuthOptions {
 upstream:Upstream;
 admitIdentity?:(identity:SessionInfo,tx?:Queryable)=>Promise<boolean>;
 env:Record<string,string|undefined>;
 /** The bearer read (`createBearerReader`): token, OAuth family fence and identity in one statement. */
 tokens:TokenReader;
 sessions:SessionStore;
 cookieSecret:string;
 secure?:boolean;
 /** The auth host's own database. With transactions (`identityDbOf(pool)`) it also hosts the identity module's calls. */
 identityDb?:Queryable|TransactionalQueryable;
 appSchema?:string;
 events?:EventsService;
 /** Private deployments may explicitly trust their preceding transport. OSS leaves this zero. */
 trustedHops?:number;
 /**
  * The identity tables with transactions, for the trusted-issuer sign-in's writes only (./identity/trusted-issuers).
  * Separate from `identityDb`, whose transactions would also turn on the identity call host.
  */
 identityTransactions?:TransactionalQueryable;
}
export type AuthEnv={Variables:{actor:Actor}};
export type AuthApp=Hono<AuthEnv>;
const aliasOrigins = new WeakMap<Pick<AuthOptions,'env'>, readonly string[]>();
/** APP__ALIAS_ORIGINS, parsed once per options; a malformed value throws when the part mounts. */
const aliasOriginsOf = (o:Pick<AuthOptions,'env'>):readonly string[] => {
  let origins=aliasOrigins.get(o);
  if(!origins){origins=parseAliasOrigins(readEnv(o.env,'APP__ALIAS_ORIGINS'));aliasOrigins.set(o,origins);}
  return origins;
};
/** App-only composition: the auth owner admits bearers without mounting login or OAuth routes.
 * Trusted internal actors already on the request remain authoritative, including refusals. */
type BearerAdmissionOptions=Pick<AuthOptions,'env'|'tokens'|'trustedHops'|'admitIdentity'>;
export function bearerAdmission(o: BearerAdmissionOptions): Part {
  return {name:'bearerAdmission',mount:app=>app.use('*',async(c,next)=>{
    if(actorOf(c.req.raw)||!c.req.raw.headers.has('authorization'))return next();
    let actor:Actor;
    try {actor=await resolveBearer(c.req.raw,o)??ANONYMOUS;}
    catch {return Response.json({error:'session_unavailable'},{status:503,headers:{'cache-control':'no-store'}});}
    // A group's sign-in has no person to admit: its authorising person's admission is its `live` rule (`users.active`).
    if(actor.userId&&o.admitIdentity&&!await o.admitIdentity({userId:actor.userId}))return Response.json({error:'deployment_admission_required'},{status:403});
    attachActor(c.req.raw,actor);
    await next();
  })};
}

export function session(o: AuthOptions): Part<AuthEnv> {
  return {
    name: 'session',
    mount: (app) => { aliasOriginsOf(o); app.use('*', async (c, next) => {
      const refresh:string[]=[];
      let admitted:Actor;
      try {admitted=await resolveActor(c.req.raw, o, refresh);}
      catch {
        // A failed lookup is not a sign-out: never render this request as anonymous.
        return new Response(JSON.stringify({error:'session_unavailable'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
      }
      if(admitted.userId&&o.admitIdentity&&!await o.admitIdentity({userId:admitted.userId,email:admitted.email,emailVerified:admitted.emailVerified}))return new Response(JSON.stringify({error:'deployment_admission_required'}),{status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});
      c.set('actor', admitted);
      await next();
      // Better Auth extends the row; the browser's cookie only follows if we forward its re-issue.
      if(admitted.credential==='session'&&refresh.length) {
        const already=new Set(c.res.headers.getSetCookie().map(value=>value.split('=')[0]));
        for(const value of refresh) if(!already.has(value.split('=')[0]!)) c.res.headers.append('set-cookie',value);
      }
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
          try {current=await resolveActor(c.req.raw,o);} catch { /* fail closed */ }
          const identity=(actor:Actor)=>[actor.credential,actor.userId,actor.tokenId,actor.email,actor.emailVerified,isGroupActor(actor)?actor.principalGroupId:null,isGroupActor(actor)?actor.principalGroupRole:null];
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
    }); },
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
      // A signed group list can be larger than an OTP. Bound both forms before parsing.
      a.use('/api/auth/*', async (c, next) => {
        if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
        const limit = c.req.path === TRUSTED_SIGNIN_PATH ? 1024 * 1024 : AUTH_BODY_LIMIT;
        try { await readBody(c.req.raw.clone(), {limit}); }
        catch (error) { if (error instanceof BodyTooLargeError) return payloadTooLarge(); throw error; }
        return next();
      });
      a.post('/api/auth/email-otp/send-verification-otp', async (c, next) => {
        const body = await c.req.raw.clone().json().catch(() => null) as { email?: unknown } | null;
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        await next();
        if (email && c.res.status >= 200 && c.res.status < 300) {
          void say(o.events, null, 'login_sent', { kind: 'user', id: email }, { email });
          // Match the runtime mailer's origin policy; do not disclose the protected outbox.
          const origin = baseUrlOf(c.req.raw, o.trustedHops ?? 0, readEnv(o.env, 'APP__PUBLIC_BASE_URL'));
          c.res.headers.set(CODE_DELIVERY_HEADER, usesDevOutbox(origin) ? 'operator_outbox' : 'email');
        }
      });
      // A sign-in sets a session cookie, so another site must not be able to start one in this browser (login
      // CSRF). Better Auth checks Origin only on requests that already carry a cookie. No Origin: not a browser.
      a.post('/api/auth/sign-in/*', async (c, next) => {
        const origin = c.req.header('origin');
        const accepted = acceptedOriginsOf(c.req.raw, o.trustedHops ?? 0, readEnv(o.env, 'APP__PUBLIC_BASE_URL'), aliasOriginsOf(o));
        if ((origin !== undefined && !accepted.includes(origin)) || c.req.header('sec-fetch-site') === 'cross-site')
          return c.json({ error: 'forbidden_origin' }, 403);
        return next();
      });
      mountTrustedSignIn(a, o);
      if (o.sessions.handler) a.all('/api/auth/*', async c => {
        const response=await o.sessions.handler!(c.req.raw);
        if(!o.admitIdentity||response.status>=400)return response;
        // Admission runs after Better Auth commits: never enqueue app SQL within its transaction.
        const cookies=new Map((c.req.header('cookie')??'').split(';').map(value=>{const at=value.indexOf('=');return [value.slice(0,at).trim(),value.slice(at+1)] as const;}));
        for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0]!,at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
        const headers=new Headers(c.req.raw.headers);headers.set('cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));
        const identity=await o.sessions.resolve(new Request(c.req.url,{headers}));
        if(identity&&!await o.admitIdentity(identity))return new Response(JSON.stringify({error:'deployment_admission_required'}),{status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});
        return response;
      });
    },
  };
}

/**
 * TRUSTED-ISSUER SIGN-IN (./identity/trusted-issuers): a form POST, usually a frame's navigation from the issuer's
 * page, so it answers like a sign-in page would: 303 to the same-origin `callbackUrl` (default `/`, `group` set to the
 * token's group when supplied) with the session
 * cookie, or a JSON refusal. Off (404) without a configured issuer. The token is checked before anything is written
 * (and the issuer's Origin before its signature); deployment admission and identity writes share a transaction before the session is created.
 */
/** The callback with `group=<the token's group>`, so the page opens in that group rather than one it remembered. */
const withGroup=(path:string,groupId:string):string=>{const url=new URL(path,'http://callback.invalid');url.searchParams.set('group',groupId);return `${url.pathname}${url.search}${url.hash}`;};
function mountTrustedSignIn(a:AuthApp,o:AuthOptions):void {
  const joinCompanyRoot=joinsCompanyRoot(o.env);
  const verifier=createTrustedTokenVerifier(trustedIssuersOf(o.env));
  const schema=readEnv(o.env,'AUTH__SCHEMA')??'auth';
  a.post(TRUSTED_SIGNIN_PATH,async c=>{
    const refuse=(error:string,status:401|403|404|415|503)=>c.json({error},status,{'cache-control':'no-store'});
    if(!verifier.enabled||!o.identityTransactions||!o.sessions.start)return refuse('not_found',404);
    if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(c.req.header('content-type')??''))return refuse('unsupported_media_type',415);
    const form=new URLSearchParams(await c.req.text());
    const checked=verifier.verify(form.get('token')??'',c.req.header('origin'));
    if(!checked.ok){
      // Which check refused the token (./identity/trusted-issuers TrustedTokenFailure): the caller sees only the refusal.
      const {ok:_ok,...refused}=checked;
      console.warn(`[identity] trusted sign-in refused ${JSON.stringify(refused)}`);
      return refuse(checked.refusal,checked.refusal==='forbidden_origin'?403:401);
    }
    const {issuer,...claims}=checked.claims;
    const result=await trustedSignIn(o.identityTransactions,{...claims,issuer:issuer.issuer,joinCompanyRoot,
      parentGroup:issuer.parentGroup,email:trustedEmailOf(issuer.issuer,claims.subject)},schema,o.appSchema??readEnv(o.env,'APP__SCHEMA'),
      o.admitIdentity && ((person,tx)=>o.admitIdentity!({userId:person.userId,email:person.email,emailVerified:true,trustedIssuer:issuer.issuer},tx)));
    if(!result.ok)console.warn(`[identity] trusted sign-in refused ${JSON.stringify({refusal:result.refusal,issuer:issuer.issuer})}`);
    if(!result.ok)return refuse(result.refusal,result.refusal==='parent_group_missing'?503:(result.refusal==='invalid_claims'||result.refusal==='replayed_token')?401:403);
    const cookies=await o.sessions.start(result.userId);
    const callback=trustedCallbackPath(form.get('callbackUrl'));
    const headers=new Headers({location:result.groupId ? withGroup(callback,result.groupId) : callback,'cache-control':'no-store'});
    for(const cookie of cookies)headers.append('set-cookie',cookie);
    return new Response(null,{status:303,headers});
  });
}

/** Standard OAuth and discovery use the same identity database as human sessions. */
export function oauthRoutes(o: AuthOptions): Part<AuthEnv> {
  return {
    name: 'oauthRoutes',
    mount: (app) => {
      if (!o.identityDb) return;
      const schema = readEnv(o.env, 'AUTH__SCHEMA') ?? 'auth';
      mountOAuthRoutes(app, {
        sessions: o.sessions,
        admitIdentity:o.admitIdentity,
        oauth: createOAuthStore(o.identityDb, schema, parseOAuthClients(readEnv(o.env, 'IDENTITY__OAUTH_CLIENTS'))),
        upstream: o.upstream,
        trustedHops: o.trustedHops ?? 0,
        publicBaseUrl: readEnv(o.env, 'APP__PUBLIC_BASE_URL'),
        aliasOrigins: aliasOriginsOf(o),
        serviceAudiences: parseServiceAudiences(readEnv(o.env, 'IDENTITY__SERVICE_AUDIENCES')),
        serviceTokenKey: o.cookieSecret ? serviceTokenKey(o.cookieSecret) : null,
        groupServiceTokenKey: o.cookieSecret ? groupServiceTokenKey(o.cookieSecret) : null,
        groupSignIns: groupSignInsOf(o.identityDb, schema, readEnv(o.env, 'IDENTITY__SCHEMA') ?? IDENTITY_SCHEMA, parseServiceAudiences(readEnv(o.env, 'IDENTITY__SERVICE_AUDIENCES')), o.events),
      });
    },
  };
}

/**
 * GROUP SIGN-INS on the auth host's own database (contracts identity-service `GROUP_SIGN_IN_RULE`): the identity store's
 * guarded mint (24 h, as every OAuth access token) and the level check the consent page asks, by the one rule.
 */
function groupSignInsOf(db: Queryable, authSchema: string, readSchema: string, serviceAudiences: readonly ServiceAudience[], events?: EventsService): GroupSignIns {
  const t = identityTables(authSchema);
  return {
    // Audited as a mint for the person who authorised it, at every issue and every refresh.
    mint: async input => {
      const minted = await mintGroupSignIn(t, db, readSchema, {...input, expiresInMs: ACCESS_TOKEN_TTL_SECONDS * 1000});
      void say(events, {kind: 'user', id: input.issuedBy}, 'minted', {kind: 'token', id: minted.id}, {name: minted.name, group_id: input.groupId});
      return minted;
    },
    heldName: async (userId, groupId, role) => (await db.query<{name: string}>(`SELECT g.name FROM ${t.groups} g WHERE g.id=$2::text AND g.deleted_at IS NULL
      AND COALESCE((SELECT issuer.active AND issuer.kind='account' AND NOT issuer.test_account FROM ${readSchema}.users issuer WHERE issuer.id=$1::text), false) AND ${groupLevelHeldSql(t, '$1::text', '$2::text', '$3::text')}`, [userId, groupId, role])).rows[0]?.name ?? null,
    live: tokenId => readLiveGroupSignIn({db, authSchema, readSchema, serviceAudiences}, tokenId),
  };
}

/** Probe the app for public build bytes before resolving a session. The deadline covers the response head. */
export function publicBuildAssets<T extends Env>({ upstream, deadlineMs }: { upstream: Upstream; deadlineMs?: number }): Part<T> {
  return {
    name: 'publicBuildAssets',
    mount: app => app.use('*', async (c, next) => {
      const request = buildAssetRequest(c.req.raw);
      if (!request) return next();
      const controller = deadlineMs !== undefined && Number.isFinite(deadlineMs) && deadlineMs > 0 ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(new Error('build asset handshake deadline exceeded')), deadlineMs) : null;
      try {
        const probe = controller ? new Request(request, { signal: AbortSignal.any([request.signal, controller.signal]) }) : request;
        const response = await upstream(probe, ANONYMOUS);
        const safe = buildAssetResponse(response);
        if (safe) return safe;
        void response.body?.cancel().catch(() => {});
      } catch {
        // The normal forwarding path retains its own availability and access behavior.
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
      return next();
    }),
  };
}

async function resolveBearer(request:Request,o:BearerAdmissionOptions):Promise<Actor|null>{
  const auth = request.headers.get('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!presented) return null;
  // One statement: the token, its OAuth family fence and the account's identity. A failed read throws (503).
  const token = await o.tokens.byToken(presented);
  // A GROUP's sign-in (contracts `GroupActor`): the reader already decided its rule; never a person, never no one's.
  if (token?.groupId) return tokenFitsRequest(token, request, o) && token.issuedBy && isGroupActorRole(token.groupRole)
    ? {credential:'bearer',principal:'group',principalGroupId:token.groupId,principalGroupRole:token.groupRole,tokenId:token.id,issuedBy:token.issuedBy} : ANONYMOUS;
  if (!token?.userId || !tokenFitsRequest(token, request, o)) return ANONYMOUS;
  return {credential:'bearer',tokenId:token.id,userId:token.userId,...(token.email!==undefined?{email:token.email,emailVerified:token.emailVerified}:{})};
}

async function resolveActor(request: Request, o: AuthOptions, refresh?: string[]): Promise<Actor> {
  const bearer=await resolveBearer(request,o);
  if(bearer)return bearer;
  const session = await o.sessions.resolve(request);
  if (session?.userId && session.email && session.emailVerified === true) {
    if (session.setCookies) refresh?.push(...session.setCookies);
    return {
      credential: 'session',
      sessionId:session.sessionId,
      userId: session.userId,
      ...(session.email ? { email: session.email } : {}),
      ...(session.emailVerified !== undefined ? { emailVerified: session.emailVerified } : {}),
    };
  }
  // Only a verified email session authenticates a browser.
  return ANONYMOUS;
}

/** OAuth access tokens are capabilities for one deployment's API (its canonical origin or an alias) and scope. */
function tokenFitsRequest(token: { audience?: string; scope?: string }, request: Request, o: BearerAdmissionOptions): boolean {
  if (!token.audience) return true;
  const origins = acceptedOriginsOf(request, o.trustedHops ?? 0, readEnv(o.env, 'APP__PUBLIC_BASE_URL'), aliasOriginsOf(o));
  const path = new URL(request.url).pathname;
  // These app-origin read adapters are part of the artifacts API even though their URLs
  // live beside the reader. Never admit the bearer to arbitrary UI or pages-host paths.
  const artifactRead = /^\/a\/[A-Za-z0-9_-]+\/(?:download|export)$/.test(path);
  return (path === '/api' || path.startsWith('/api/') || artifactRead) && origins.some((origin) => token.audience === `${origin}/api`) && (token.scope?.split(/\s+/).includes('artifacts') ?? false);
}

export function authParts(o:AuthOptions):Part<AuthEnv>[] {
 return [sessionAuthority(o),publicBuildAssets(o),session(o),internalBoundary(),loginRoutes(o),oauthRoutes(o),{name:'application',mount:app=>app.all('*',c=>o.upstream(c.req.raw,c.get('actor')))}];
}
export const createAuthHost=(o:AuthOptions):AuthApp=>assemble(authParts(o));
