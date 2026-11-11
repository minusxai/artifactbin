/**
 * Auth-owned RPC, mounted before browser/session resolution and the public internal-path refusal. Every route here
 * is service-authenticated (SERVICE_AUTH_HEADER) and refused without it:
 *  - session-live (INTERNAL__SERVICE_SECRET): is a human session still live (the pages sessions' revalidation);
 *  - identity introspection (contracts `IDENTITY_INTROSPECT_PATH`): a presented token, answered with its user, id,
 *    scopes, audience, expiry and, for a viewer token, the first-party actor and the page and function that asked. An
 *    access token is read by the one bearer read every API request is admitted by (token, OAuth family fence,
 *    identity) and must be bound to this deployment's API or to a configured service (IDENTITY__SERVICE_AUDIENCES); a
 *    viewer or exchanged token is verified by its signature (./identity/service-tokens), an exchanged one also by its
 *    parent credential's `live` in the identity views (`tokens` or `sessions`, the rule every reader re-checks with).
 *    Every kind needs an ACTIVE account. Asked
 *    with INTERNAL__SERVICE_SECRET the answer covers every token; asked with a configured service's own introspection
 *    secret it covers only tokens bound to that service's origin, every other one answering `{active: false}`;
 *  - THE IDENTITY MODULE's calls (contracts `IDENTITY_CALL_PATH`, `IdentityService`, INTERNAL__SERVICE_SECRET only):
 *    every write to users, tokens, handles, groups, memberships, invitations and the group mail outbox, and the
 *    viewer-token mint, run by the identity store (`./identity-store`) on `identityDb` (which must offer
 *    transactions: `identityDbOf(pool)`) against the app's tables (`appSchema`). `{method, input}` in; `{result}` or
 *    `{refused: {code, status, retry_after?, detail?}}` out, both 200; anything else (no transactional database, a
 *    failure) is 503 and the caller's call throws.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {API_RESOURCE_PATH,FIRST_PARTY_ACTOR,HUMAN_SESSION_LIVE_PATH,IDENTITY_CALL_PATH,IDENTITY_SCHEMA,IDENTITY_INTROSPECT_PATH,IDENTITY_METHODS,IdentityError,SERVICE_AUTH_HEADER,parseAliasOrigins,parseServiceAudiences,type IdentityIntrospectResponse,type IdentityMethod,type IdentityService,type Part,type ServiceAudience,type ServiceTokenParent,type TokenRecord,type TransactionalQueryable} from '@artifactbin/contracts';
import {BodyTooLargeError,readBody,serviceSecretMatches} from '@artifactbin/utils';
import type {Context} from 'hono';
import type {AuthEnv,AuthOptions} from './parts';
import {acceptedOriginsOf} from './routes/oauth';
import {readEnv} from './env';
import {testDomainSignInOf} from './config';
import {IdentityNotReady,createIdentityStore,ensureIdentitySchema} from './identity-store';
import {isViewerToken,verifyViewerToken,viewerTokenKey} from './identity/service-tokens';
const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
/** The configured service whose introspection secret `presented` is, compared in constant time; undefined when none. */
const serviceOf=(audiences:readonly ServiceAudience[],presented:string|undefined):ServiceAudience|undefined=>{
 if(!presented)return undefined;
 const digest=Buffer.from(sha256(presented));
 return audiences.find(service=>!!service.introspectionSecretSha256&&timingSafeEqual(Buffer.from(service.introspectionSecretSha256),digest));
};
export function sessionAuthority(o:AuthOptions):Part<AuthEnv>{return {name:'sessionAuthority',mount:app=>{
 const secret=readEnv(o.env,'INTERNAL__SERVICE_SECRET');
 const audiences=parseServiceAudiences(readEnv(o.env,'IDENTITY__SERVICE_AUDIENCES'));
 const viewerKey=o.cookieSecret?viewerTokenKey(o.cookieSecret):null;
 /** A refusal Response, or the parsed JSON object body. `admitted` decides the credential (default: the installation's). */
 const admit=async(c:Context<AuthEnv>,admitted:(presented:string|undefined)=>boolean=presented=>serviceSecretMatches(presented,secret)):Promise<Response|Record<string,unknown>>=>{
  if(c.req.method!=='POST')return answer({error:'method_not_allowed'},405);
  if(!admitted(c.req.header(SERVICE_AUTH_HEADER)))return answer({error:'unauthorized'},401);
  let body:unknown;
  try{body=JSON.parse(await readBody(c.req.raw,{limit:8192,as:'text'}));}catch(e){return answer({error:e instanceof BodyTooLargeError?'too_large':'bad_request'},e instanceof BodyTooLargeError?413:400);}
  return body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:answer({error:'bad_request'},400);
 };
 app.all(HUMAN_SESSION_LIVE_PATH,async c=>{
  const input=await admit(c);if(input instanceof Response)return input;
  if(typeof input.sessionId!=='string'||!input.sessionId||typeof input.userId!=='string'||!input.userId)return answer({error:'bad_request'},400);
  try{return answer({live:await o.sessions.live?.(input.sessionId,input.userId)??false});}catch{return answer({error:'session_unavailable'},503);}
 });
 /**
  * Is the bearer read's record a live credential of this deployment's account: an account's token, an OAuth access
  * token for one of this deployment's API origins or for a configured service's origin, and an ACTIVE account, by the
  * one rule every reader applies (the `users` read view's `active`, ./identity-store/views), read on this host's
  * database. The record, or null.
  */
 const activeUser=async(userId:string)=>!!o.identityDb&&(await o.identityDb.query<{active:boolean}>(`SELECT active FROM ${readSchema}.users WHERE id=$1`,[userId])).rows[0]?.active===true;
 const live=async(c:Context<AuthEnv>,token:TokenRecord|null):Promise<(TokenRecord&{userId:string})|null>=>{
  const userId=token?.userId;
  if(!token||!userId||!o.identityDb)return null;
  const origins=acceptedOriginsOf(c.req.raw,o.trustedHops??0,readEnv(o.env,'APP__PUBLIC_BASE_URL'),parseAliasOrigins(readEnv(o.env,'APP__ALIAS_ORIGINS')));
  if(token.audience&&!origins.some(origin=>token.audience===`${origin}${API_RESOURCE_PATH}`)&&!audiences.some(service=>service.origin===token.audience))return null;
  return await activeUser(userId)?{...token,userId}:null;
 };
 /** An exchanged token's parent, still live for that same user: its row in the `tokens` or `sessions` view, as a service re-checks it. */
 const parentLive=async(parent:ServiceTokenParent,userId:string)=>!!o.identityDb&&(await o.identityDb.query<{live:boolean}>(parent.kind==='token'
  ?`SELECT live FROM ${readSchema}.tokens WHERE id=$1 AND user_id=$2`:`SELECT live FROM ${readSchema}.sessions WHERE id=$1 AND "userId"=$2`,[parent.id,userId])).rows[0]?.live===true;
 app.all(IDENTITY_INTROSPECT_PATH,async c=>{
  // The installation itself (every token), or one configured service (only tokens bound to its own origin).
  const asker:{only:ServiceAudience|null}={only:null};
  const input=await admit(c,presented=>serviceSecretMatches(presented,secret)||!!(asker.only=serviceOf(audiences,presented)??null));if(input instanceof Response)return input;
  const only=asker.only;
  if(typeof input.token!=='string'||!input.token)return answer({error:'bad_request'},400);
  const inactive=answer({active:false} satisfies IdentityIntrospectResponse);
  try{
   if(isViewerToken(input.token)){
    const claims=viewerKey?verifyViewerToken(viewerKey,audiences,input.token):null;
    if(!claims||(only&&claims.aud!==only.origin)||!await activeUser(claims.sub)||(claims.par&&!await parentLive(claims.par,claims.sub)))return inactive;
    return answer({active:true,user_id:claims.sub,token_id:claims.jti,scopes:[],audience:claims.aud,expires_at:new Date(claims.exp*1000).toISOString(),
     actor:claims.par?null:{id:FIRST_PARTY_ACTOR,artifact_id:claims.act.artifact_id??null,function:claims.act.function??null},parent:claims.par??null} satisfies IdentityIntrospectResponse);
   }
   const token=await live(c,await o.tokens.byToken(input.token));
   if(!token||(only&&token.audience!==only.origin))return inactive;
   return answer({active:true,user_id:token.userId,token_id:token.id,scopes:token.scope?.split(/\s+/).filter(Boolean)??[],audience:token.audience??null,expires_at:token.expiresAt??null,actor:null,parent:null} satisfies IdentityIntrospectResponse);
  }catch{return answer({error:'session_unavailable'},503);}
 });
 const transactional=(db:unknown):db is TransactionalQueryable=>typeof (db as TransactionalQueryable|undefined)?.transaction==='function';
 let identity:Promise<IdentityService>|null=null;
 const authSchema=readEnv(o.env,'AUTH__SCHEMA')??'auth',readSchema=readEnv(o.env,'IDENTITY__SCHEMA')??IDENTITY_SCHEMA;
 if(!/^[a-z_][a-z0-9_]*$/.test(readSchema))throw Error(`IDENTITY__SCHEMA ${JSON.stringify(readSchema)} is not a plain lowercase identifier`);
 /** The store over the auth host's own connection, its schema ensured once (a failure is retried on the next call). */
 const store=():Promise<IdentityService>=>identity??=(async()=>{
  const db=o.identityDb,appSchema=o.appSchema??readEnv(o.env,'APP__SCHEMA');
  if(!transactional(db)||!appSchema)throw Error('identity_unavailable');
  await ensureIdentitySchema(db,{auth:authSchema,app:appSchema,read:readSchema});
  return createIdentityStore({db,authSchema,testDomain:testDomainSignInOf(o.env,()=>{})?.domain,serviceTokens:{secret:o.cookieSecret,audiences}});
 })().catch(error=>{identity=null;throw error;});
 // The identity host's boot, started with the part: the app's boot waits for the views this creates, and this waits
 // (retrying while IdentityNotReady: the app's own tables come first) for the app's. Never awaited by a request.
 if(transactional(o.identityDb)&&(o.appSchema??readEnv(o.env,'APP__SCHEMA'))){
  let attempts=0;
  const boot=()=>{void store().catch(error=>{
   if(!(error instanceof IdentityNotReady)||++attempts>300)return;
   if(attempts===1)console.warn(`[identity] ${error.message} (retrying every 2 s)`);
   setTimeout(boot,2000).unref?.();
  });};
  boot();
 }
 app.all(IDENTITY_CALL_PATH,async c=>{
  const input=await admit(c);if(input instanceof Response)return input;
  const method=input.method as IdentityMethod;
  if(typeof method!=='string'||!IDENTITY_METHODS.includes(method)||!input.input||typeof input.input!=='object'||Array.isArray(input.input))return answer({error:'bad_request'},400);
  let service:IdentityService;
  try{service=await store();}catch{return answer({error:'identity_unavailable'},503);}
  try{
   const call=service[method] as (argument:unknown)=>Promise<unknown>;
   const result=await call(input.input);
   return answer({result:result===undefined?null:result});
  }catch(error){
   if(error instanceof IdentityError)return answer({refused:{code:error.code,status:error.status,...(error.retryAfter!==undefined?{retry_after:error.retryAfter}:{}),...(error.detail!==undefined?{detail:error.detail}:{})}});
   return answer({error:'identity_unavailable'},503);
  }
 });
}};}
