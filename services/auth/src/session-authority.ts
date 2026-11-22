/**
 * Auth-owned RPC, mounted before browser/session resolution and the public internal-path refusal. Every route here
 * is service-authenticated (SERVICE_AUTH_HEADER) and refused without it:
 *  - session-live (INTERNAL__SERVICE_SECRET): is a human session still live (the pages sessions' revalidation);
 *  - identity introspection (contracts `IDENTITY_INTROSPECT_PATH`): a presented token, answered with its principal
 *    (a person, `principal_kind: 'user'`, or for a group's sign-in the group at its level with `user_id` null:
 *    contracts identity-service `GROUP_SIGN_IN_RULE`, which the bearer read decides), user, id, scopes, audience,
 *    expiry and, for an exchanged token, the credential it was issued for. An
 *    access token is read by the one bearer read every API request is admitted by (token, OAuth family fence,
 *    identity) and must be bound to this deployment's API or to a configured service (IDENTITY__SERVICE_AUDIENCES); a
 *    exchanged token is verified by its signature (./identity/service-tokens) and by its
 *    parent credential's `live` in the identity views (`tokens` or `sessions`, the rule every reader re-checks with).
 *    Every kind needs an ACTIVE account. A GROUP's exchanged token (contracts service-audiences `group_principals`)
 *    answers the group (`principal_kind: 'group'`, no person, `parent` its group sign-in) only for a service still
 *    opted in, and only while that parent is live by the bearer read's own rule (./identity/bearer
 *    `readLiveGroupSignIn`), as the same group, level and issuer. Asked
 *    with INTERNAL__SERVICE_SECRET the answer covers every token; asked with a configured service's own introspection
 *    secret it covers only tokens bound to that service's origin, every other one answering `{active: false}`;
 *  - THE IDENTITY MODULE's calls (contracts `IDENTITY_CALL_PATH`, `IdentityService`, INTERNAL__SERVICE_SECRET only):
 *    every write to users, tokens, handles, groups, memberships, invitations and the group mail outbox, run by the
 *    identity store (`./identity-store`) on `identityDb` (which must offer
 *    transactions: `identityDbOf(pool)`) against the app's tables (`appSchema`). `{method, input}` in; `{result}` or
 *    `{refused: {code, status, retry_after?, detail?}}` out, both 200; anything else (no transactional database, a
 *    failure) is 503 and the caller's call throws;
 *  - a relay's draft check (contracts `DRAFT_CHECK_PATH`), admitted and forwarded as the chart drawing below is;
 *  - a relay's chart drawing (contracts `CHART_IMAGE_PATH`, a service opted in with `artifact_reads`): no person, exact
 *    keys, forwarded to the app's fixed seam and answered as it answers;
 *  - a RUN SIGN-IN (contracts `RUN_SIGN_IN_PATH`, a service opted in with `run_sign_ins`, its own secret): the person's
 *    exchanged token for that service, verified as introspection verifies it, becomes an ordinary API access token for
 *    that person with no refresh token (./identity-store/accounts `mintRunSignIn`), audited as a mint. Without the
 *    opt-in, or with another credential in the header, the path is passed on as any unknown one;
 *  - a GROUP SIGN-IN for a service (contracts `GROUP_SIGN_IN_PATH`, a service opted in with `group_sign_ins`, its own
 *    secret): an approval a group's Admin gave THAT service becomes an ordinary API access token acting as the group at
 *    the approval's level, with no refresh token (./identity-store/accounts `mintServiceGroupSignIn`), audited as a
 *    mint by the group, for at most a day. Without the opt-in, or with another credential in the header, an unknown
 *    path; so is the service's list of its own approvals (contracts `GROUP_SIGN_IN_GRANTS_PATH`), behind the same door.
 *
 * The installation's own secret is for callers inside only: a request that came through a front (it carries
 * X-Forwarded-For, which every front sets, a deployment's nginx or router included) meets session-live and the identity
 * module's calls as an unknown path, whatever it presents. Callers use the internal address and send no forwarding
 * header (utils `humanSessionClient`, `identityClient`). A configured service's own secret (introspection, the
 * sign-ins, the relays) is the same behind a front as inside.
 *
 * Introspection and the sign-ins are ./token-authority; the door they all share (settings, admission, `answer`) is
 * ./authority-door; the relays and the identity module's calls are below.
 */
import { CANONICAL_CHART_IMAGE_PATH, CHART_IMAGE_KEYS, CANONICAL_DRAFT_CHECK_PATH, DRAFT_CHECK_KEYS } from '@artifactbin/contracts/identity-service';
import {ANONYMOUS} from '@artifactbin/contracts/actor';
import {SERVICE_PAYLOAD_LIMIT} from '@artifactbin/contracts/payload-limit';
import {HUMAN_SESSION_LIVE_PATH} from '@artifactbin/contracts/actor';
import {IDENTITY_CALL_PATH, IDENTITY_METHODS, IdentityError, type IdentityMethod, type IdentityService, type TransactionalQueryable} from '@artifactbin/contracts/identity-module';
import type {Part} from '@artifactbin/contracts/part';
import type {ServiceAudience} from '@artifactbin/contracts/service-audiences';
import {BodyTooLargeError, readBody} from '@artifactbin/utils/body';
import type {Context,Hono} from 'hono';
import type {AuthEnv,AuthOptions} from './parts';
import {readEnv} from './env';
import {testDomainSignInOf} from './config';
import {backfillTrustedRoot} from './identity-store/trusted-root-backfill';
import {IdentityNotReady,createIdentityStore,ensureIdentitySchema} from './identity-store';
import {admitService,answer,authorityConfig,serviceOf,type AuthorityConfig} from './authority-door';
import {mountTokenAuthority} from './token-authority';
import { serviceSecretMatches } from './token-authority';

/**
 * A trusted relay's draft check (the same `artifact_reads` opt-in and per-service introspection secret as chart-image,
 * no grant: the check reads no data). POST exactly DRAFT_CHECK_KEYS, `html` and `files` required (the draft's own
 * `{path, base64, contentType?}` files, entryPath its page's path among them), at most SERVICE_PAYLOAD_LIMIT bytes. The
 * identity owner forwards it to the fixed app seam as the anonymous actor and passes its status and JSON through:
 * `{problems: PageProblem[], truncated, image?: PageImage}` (contracts browser), a draft's refusal `{error: DraftRefusalCode, message}`,
 * 413 `too_large` or 503 `check_unavailable`.
 */
export const DRAFT_CHECK_PATH = '/api/internal/identity/draft-check';

/**
 * Purpose-only chart drawing for a trusted relay (the `artifact_reads` opt-in and the service's own introspection
 * secret, nothing else: drawing reads no data). POST
 * exactly a subset of CHART_IMAGE_KEYS with `chart` and `rows`, at most SERVICE_PAYLOAD_LIMIT bytes. The identity
 * owner forwards that body to the fixed app seam and passes its status and JSON through, buffered to at most
 * SERVICE_PAYLOAD_LIMIT: `ChartImageWire`, or `{error, message, hint?}`.
 */
export const CHART_IMAGE_PATH = '/api/internal/identity/chart-image';

/**
 * A relay's chart drawing (contracts CHART_IMAGE_PATH) and draft check (DRAFT_CHECK_PATH): admitted by the service's own
 * introspection secret and its `artifact_reads` opt-in, exact keys (the required ones present), no person (neither
 * reads data). The body goes to the fixed app seam as the anonymous actor; its status and JSON come back buffered to
 * at most SERVICE_PAYLOAD_LIMIT, within the relay's time.
 */
const RELAYS=[
 {path:CHART_IMAGE_PATH,to:CANONICAL_CHART_IMAGE_PATH,keys:CHART_IMAGE_KEYS as readonly string[],required:['chart','rows'],timeoutMs:60000,unavailable:'render_unavailable'},
 {path:DRAFT_CHECK_PATH,to:CANONICAL_DRAFT_CHECK_PATH,keys:DRAFT_CHECK_KEYS as readonly string[],required:['html','files'],timeoutMs:30000,unavailable:'check_unavailable'},
];
function mountRelays(app:Hono<AuthEnv>,o:AuthOptions,audiences:readonly ServiceAudience[]):void{
 for(const relay of RELAYS)app.all(relay.path,async c=>{
  let service:ServiceAudience|undefined;
  const input=await admitService(c,presented=>!!(service=serviceOf(audiences,presented))&&service.artifactReads===true,SERVICE_PAYLOAD_LIMIT);
  if(input instanceof Response)return input;
  const keys=Object.keys(input);
  if(relay.required.some(key=>!keys.includes(key))||keys.some(key=>!relay.keys.includes(key)))return answer({error:'bad_request'},400);
  try{
   const signal=AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(relay.timeoutMs)]);
   const response=await o.upstream(new Request(new URL(relay.to,c.req.url),{method:'POST',body:JSON.stringify(input),signal}),ANONYMOUS);
   const body=await readBody(response,{limit:SERVICE_PAYLOAD_LIMIT,as:'text'});
   return new Response(body,{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch(error){return error instanceof BodyTooLargeError?answer({error:'too_large',max:SERVICE_PAYLOAD_LIMIT},413):answer({error:relay.unavailable},503);}
 });
}

/** The request came through a front (see the header): the installation-secret routes are not there for it. */
const throughFront=(c:Context<AuthEnv>)=>c.req.header('x-forwarded-for')!==undefined;

/** The identity module's calls (IDENTITY_CALL_PATH), and the identity host's boot, started with the part. */
function mountIdentityCalls(app:Hono<AuthEnv>,o:AuthOptions,{authSchema,readSchema}:AuthorityConfig,installation:(presented:string|undefined)=>boolean):void{
 const transactional=(db:unknown):db is TransactionalQueryable=>typeof (db as TransactionalQueryable|undefined)?.transaction==='function';
 let identity:Promise<IdentityService>|null=null;
 /** The store over the auth host's own connection, its schema ensured once (a failure is retried on the next call). */
 const store=():Promise<IdentityService>=>identity??=(async()=>{
  const db=o.identityDb,appSchema=o.appSchema??readEnv(o.env,'APP__SCHEMA');
  if(!transactional(db)||!appSchema)throw Error('identity_unavailable');
  await ensureIdentitySchema(db,{auth:authSchema,app:appSchema,read:readSchema});
  await backfillTrustedRoot(db,o.env,authSchema,appSchema);
  return createIdentityStore({db,authSchema,appSchema,testDomain:testDomainSignInOf(o.env,()=>{})?.domain});
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
 app.all(IDENTITY_CALL_PATH,async(c,next)=>{
  if(throughFront(c))return next();
  const input=await admitService(c,installation);if(input instanceof Response)return input;
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
}

export function sessionAuthority(o:AuthOptions):Part<AuthEnv>{return {name:'sessionAuthority',mount:app=>{
 const config=authorityConfig(o);
 const installation=(presented:string|undefined)=>serviceSecretMatches(presented,config.secret);
 app.all(HUMAN_SESSION_LIVE_PATH,async(c,next)=>{
  if(throughFront(c))return next();
  const input=await admitService(c,installation);if(input instanceof Response)return input;
  if(typeof input.sessionId!=='string'||!input.sessionId||typeof input.userId!=='string'||!input.userId)return answer({error:'bad_request'},400);
  try{return answer({live:await o.sessions.live?.(input.sessionId,input.userId)??false});}catch{return answer({error:'session_unavailable'},503);}
 });
 mountTokenAuthority(app,o,config);
 mountRelays(app,o,config.audiences);
 mountIdentityCalls(app,o,config,installation);
}};}
