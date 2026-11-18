import {PAGE_EVIDENCE_PATH,CANONICAL_PAGE_EVIDENCE_PATH,isPageEvidenceOperation} from '@artifactbin/contracts';
import {ARTIFACT_WORKLOAD_PATH,APP_ARTIFACT_WORKLOAD_PATH,SERVICE_PAYLOAD_LIMIT,isWorkloadBinding,isArtifactWorkloadOperation} from '@artifactbin/contracts';
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
 *    Every kind needs an ACTIVE account. Asked
 *    with INTERNAL__SERVICE_SECRET the answer covers every token; asked with a configured service's own introspection
 *    secret it covers only tokens bound to that service's origin, every other one answering `{active: false}`;
 *  - THE IDENTITY MODULE's calls (contracts `IDENTITY_CALL_PATH`, `IdentityService`, INTERNAL__SERVICE_SECRET only):
 *    every write to users, tokens, handles, groups, memberships, invitations and the group mail outbox, run by the
 *    identity store (`./identity-store`) on `identityDb` (which must offer
 *    transactions: `identityDbOf(pool)`) against the app's tables (`appSchema`). `{method, input}` in; `{result}` or
 *    `{refused: {code, status, retry_after?, detail?}}` out, both 200; anything else (no transactional database, a
 *    failure) is 503 and the caller's call throws;
 *  - a relay's chart drawing (contracts `CHART_IMAGE_PATH`, a service opted in with `artifact_reads`): no person, no
 *    grant, exact keys, forwarded to the app's fixed seam and answered as it answers;
 *  - a RUN SIGN-IN (contracts `RUN_SIGN_IN_PATH`, a service opted in with `run_sign_ins`, its own secret): the person's
 *    exchanged token for that service, verified as introspection verifies it, becomes an ordinary API access token for
 *    that person with no refresh token (./identity-store/accounts `mintRunSignIn`), audited as a mint. Without the
 *    opt-in, or with another credential in the header, the path is passed on as any unknown one.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {CHART_IMAGE_PATH,CANONICAL_CHART_IMAGE_PATH,CHART_IMAGE_KEYS,ANONYMOUS,ARTIFACT_SCOPE,DEFAULT_TOKEN_TTL_MS,MAX_TOKEN_TTL_MS,MIN_TOKEN_TTL_MS,RUN_SIGN_IN_PATH,type RunSignIn} from '@artifactbin/contracts';
import {ARTIFACT_IMAGE_DEADLINE_MS,ARTIFACT_IMAGE_ERRORS,ARTIFACT_IMAGE_ERROR_FIELDS,ARTIFACT_IMAGE_PATH,CANONICAL_ARTIFACT_IMAGE_PATH,ELEMENT_CAPTURE,ARTIFACT_READ_GRANT_PATH,ARTIFACT_READ_PATH,CANONICAL_ARTIFACT_READ_PATH,API_RESOURCE_PATH,HUMAN_SESSION_LIVE_PATH,IDENTITY_CALL_PATH,IDENTITY_SCHEMA,IDENTITY_INTROSPECT_PATH,IDENTITY_METHODS,IdentityError,SERVICE_AUTH_HEADER,parseAliasOrigins,parseServiceAudiences,type IssuedArtifactReadGrant,type IdentityIntrospectResponse,type IdentityMethod,type IdentityService,type Part,type ServiceAudience,type ServiceTokenParent,type TokenRecord,type TransactionalQueryable} from '@artifactbin/contracts';
import {BodyTooLargeError,readBody,serviceSecretMatches} from '@artifactbin/utils';
import type {Context} from 'hono';
import type {AuthEnv,AuthOptions} from './parts';
import {acceptedOriginsOf,baseUrlOf} from './routes/oauth';
import {mintRunSignIn} from './identity-store/accounts';
import {identityTables} from './identity-store/tables';
import {say} from './events';
import {readEnv} from './env';
import {testDomainSignInOf} from './config';
import {IdentityNotReady,createIdentityStore,ensureIdentitySchema} from './identity-store';
import {isServiceToken,verifyServiceToken,serviceTokenKey} from './identity/service-tokens';
import {artifactReadKey,signArtifactReadGrant,verifyArtifactReadGrant} from './identity/artifact-read-grants';
/** A person's token: no group principal. */
const PERSON={group_id:null,group_role:null,issued_by:null} as const;
/** The lifetime a run sign-in asks for (`expires_in`, seconds; absent: the default), clamped to the token bounds; null when malformed. */
const runLifetime=(asked:unknown):number|null=>asked===undefined?DEFAULT_TOKEN_TTL_MS
 :typeof asked==='number'&&Number.isFinite(asked)&&asked>0?Math.min(MAX_TOKEN_TTL_MS,Math.max(MIN_TOKEN_TTL_MS,Math.round(asked*1000))):null;
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
 const tokenKey=o.cookieSecret?serviceTokenKey(o.cookieSecret):null;
 /** A refusal Response, or the parsed JSON object body. `admitted` decides the credential (default: the installation's). */
 const admit=async(c:Context<AuthEnv>,admitted:(presented:string|undefined)=>boolean=presented=>serviceSecretMatches(presented,secret),limit=8192):Promise<Response|Record<string,unknown>>=>{
  if(c.req.method!=='POST')return answer({error:'method_not_allowed'},405);
  if(!admitted(c.req.header(SERVICE_AUTH_HEADER)))return answer({error:'unauthorized'},401);
  let body:unknown;
  try{body=JSON.parse(await readBody(c.req.raw,{limit,as:'text'}));}catch(e){return e instanceof BodyTooLargeError?answer({error:'too_large',max:limit},413):answer({error:'bad_request'},400);}
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
 const live=async(c:Context<AuthEnv>,token:TokenRecord|null):Promise<TokenRecord|null>=>{
  if(!token||!o.identityDb||(!token.userId&&!token.groupId))return null;
  const origins=acceptedOriginsOf(c.req.raw,o.trustedHops??0,readEnv(o.env,'APP__PUBLIC_BASE_URL'),parseAliasOrigins(readEnv(o.env,'APP__ALIAS_ORIGINS')));
  if(token.audience&&!origins.some(origin=>token.audience===`${origin}${API_RESOURCE_PATH}`)&&!audiences.some(service=>service.origin===token.audience))return null;
  // A group's sign-in: the bearer read applied its whole rule (the authorising person's `active` included).
  if(token.groupId)return token.userId===null&&token.issuedBy&&token.groupRole?token:null;
  return await activeUser(token.userId!)?token:null;
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
   if(isServiceToken(input.token)){
    const claims=tokenKey?verifyServiceToken(tokenKey,audiences,input.token):null;
    if(!claims||(only&&claims.aud!==only.origin)||!await activeUser(claims.sub)||!await parentLive(claims.par,claims.sub))return inactive;
    return answer({active:true,principal_kind:'user',user_id:claims.sub,token_id:claims.jti,scopes:[],audience:claims.aud,expires_at:new Date(claims.exp*1000).toISOString(),parent:claims.par,...PERSON} satisfies IdentityIntrospectResponse);
   }
   const token=await live(c,await o.tokens.byToken(input.token));
   if(!token||(only&&token.audience!==only.origin))return inactive;
   if(token.groupId&&token.groupRole&&token.issuedBy)return answer({active:true,principal_kind:'group',user_id:null,token_id:token.id,scopes:token.scope?.split(/\s+/).filter(Boolean)??[],audience:token.audience??null,expires_at:token.expiresAt??null,parent:null,group_id:token.groupId,group_role:token.groupRole,issued_by:token.issuedBy} satisfies IdentityIntrospectResponse);
   return answer({active:true,principal_kind:'user',user_id:token.userId!,token_id:token.id,scopes:token.scope?.split(/\s+/).filter(Boolean)??[],audience:token.audience??null,expires_at:token.expiresAt??null,parent:null,...PERSON,issued_by:token.issuedBy??null} satisfies IdentityIntrospectResponse);
  }catch{return answer({error:'session_unavailable'},503);}
 });
 app.all(RUN_SIGN_IN_PATH,async(c,next)=>{
  // Only a service that opted in, presenting its own secret, reaches this route; anyone else meets an unknown path.
  const service=serviceOf(audiences,c.req.header(SERVICE_AUTH_HEADER));
  if(!service?.runSignIns)return next();
  const input=await admit(c,()=>true);if(input instanceof Response)return input;
  if(Object.keys(input).some(key=>key!=='token'&&key!=='expires_in')||typeof input.token!=='string'||!input.token)return answer({error:'bad_request'},400);
  const lifetime=runLifetime(input.expires_in);
  if(lifetime===null)return answer({error:'invalid_expiry'},400);
  const unauthorized=answer({error:'unauthorized'},401);
  try{
   // The person's exchanged token for THIS service, exactly as introspection verifies one; never an ordinary bearer.
   const claims=isServiceToken(input.token)&&tokenKey?verifyServiceToken(tokenKey,audiences,input.token):null;
   if(!claims||claims.svc!==service.id||claims.aud!==service.origin||!await activeUser(claims.sub)||!await parentLive(claims.par,claims.sub)
    ||(o.admitIdentity&&!await o.admitIdentity({userId:claims.sub})))return unauthorized;
   // One level only: a run sign-in is never the parent of another.
   if(claims.par.kind==='token'&&(await o.identityDb!.query<{issued_by:string|null}>(`SELECT issued_by FROM ${readSchema}.tokens WHERE id=$1`,[claims.par.id])).rows[0]?.issued_by)
    return answer({error:'parent_not_eligible'},403);
   const server=baseUrlOf(c.req.raw,o.trustedHops??0,readEnv(o.env,'APP__PUBLIC_BASE_URL'));
   const minted=await mintRunSignIn(identityTables(authSchema),o.identityDb!,authSchema,{userId:claims.sub,service:service.id,parent:claims.par,expiresInMs:lifetime,audience:`${server}${API_RESOURCE_PATH}`,scope:ARTIFACT_SCOPE});
   void say(o.events,{kind:'user',id:claims.sub},'minted',{kind:'token',id:minted.id},{name:minted.name});
   const expiresAt=minted.expiresAt!;
   return answer({access_token:minted.token,token_type:'Bearer',token_id:minted.id,expires_at:expiresAt,expires_at_ms:Date.parse(expiresAt),server} satisfies RunSignIn);
  }catch(error){
   if(error instanceof IdentityError)return answer({error:error.code,...(error.retryAfter!==undefined?{retry_after:error.retryAfter}:{})},error.status);
   return answer({error:'session_unavailable'},503);
  }
 });
 app.all(ARTIFACT_WORKLOAD_PATH,async c=>{
  let service:ServiceAudience|undefined;
  const input=await admit(c,presented=>!!(service=serviceOf(audiences,presented))&&!!service.artifactWorkloads,SERVICE_PAYLOAD_LIMIT+8192);
  if(input instanceof Response)return input;
  if(Object.keys(input).length!==2||!isWorkloadBinding(input.principal)||!isArtifactWorkloadOperation(input.operation))return answer({error:'bad_request'},400);
  if(input.principal.issuerId!==service!.id)return answer({error:'forbidden'},403);
  if(c.req.raw.signal.aborted)return answer({error:'cancelled'},403);
  try{
   const request=new Request(new URL(APP_ARTIFACT_WORKLOAD_PATH,c.req.url),{method:'POST',body:JSON.stringify({operation:input.operation}),signal:c.req.raw.signal});
   const response=await o.upstream(request,{credential:'workload',serviceWorkload:true,workload:input.principal});
   const body=await readBody(response,{limit:SERVICE_PAYLOAD_LIMIT,as:'text'});
   return new Response(body,{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch(error){return error instanceof BodyTooLargeError?answer({error:'too_large',max:SERVICE_PAYLOAD_LIMIT},413):answer({error:'workload_unavailable'},503);}
 });
 const grantKey=artifactReadKey(o.cookieSecret);
 // Identity owns its deadline boundary too, including stalled upstream/body readers after app buffering.
 const evidenceStep=<T>(signal:AbortSignal,pending:Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
  pending.then(value=>{signal.removeEventListener('abort',abort);signal.aborted?reject(signal.reason):resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  if(signal.aborted)abort();
 });
 app.all(PAGE_EVIDENCE_PATH,async c=>{
  let service:ServiceAudience|undefined;
  const signal=AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(20000)]);
  let input:Response|Record<string,unknown>;
  try{input=await evidenceStep(signal,admit(c,presented=>!!(service=serviceOf(audiences,presented))&&service.artifactReads===true,SERVICE_PAYLOAD_LIMIT+8192));}catch{return answer({error:'evidence_unavailable'},503);}
  if(input instanceof Response)return input;
  if(Object.keys(input).length!==2||typeof input.grant!=='string'||!isPageEvidenceOperation(input.operation))return answer({error:'bad_request'},400);
  try{
   const claims=verifyArtifactReadGrant(grantKey,audiences,input.grant);
   const liveClaims=async()=>{signal.throwIfAborted();return !!claims&&claims.exp>Math.floor(Date.now()/1000)&&claims.svc===service!.id&&claims.aud===service!.origin&&await activeUser(claims.sub)&&await parentLive(claims.par,claims.sub)&&(!o.admitIdentity||await o.admitIdentity({userId:claims.sub}));};
   if(!await evidenceStep(signal,liveClaims())||!claims)return answer({error:'unauthorized'},401);
   const invoke=(fingerprint?:string)=>o.upstream(new Request(new URL(CANONICAL_PAGE_EVIDENCE_PATH,c.req.url),{method:'POST',body:JSON.stringify({operation:input.operation,...(fingerprint?{fingerprint}:{})}),signal}),{credential:'session',userId:claims.sub});
   const response=await evidenceStep(signal,invoke());
   const buffered=await evidenceStep(signal,readBody(response,{limit:2*SERVICE_PAYLOAD_LIMIT+2048,as:'text'}));
   if(response.status!==200)return answer({error:'evidence_unavailable'},response.status);
   const envelope=JSON.parse(buffered);
   if(typeof envelope.body!=='string'||Buffer.byteLength(envelope.body)>SERVICE_PAYLOAD_LIMIT||typeof envelope.fingerprint!=='string')return answer({error:'too_large',max:SERVICE_PAYLOAD_LIMIT},413);
   if(!await evidenceStep(signal,liveClaims()))return answer({error:'unauthorized'},401);
   const checked=await evidenceStep(signal,invoke(envelope.fingerprint));
   void checked.body?.cancel().catch(()=>{});
   if(checked.status!==200)return answer({error:'evidence_unavailable'},409);
   if(!await evidenceStep(signal,liveClaims()))return answer({error:'unauthorized'},401);
   signal.throwIfAborted();
   return new Response(envelope.body,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch(error){return error instanceof BodyTooLargeError?answer({error:'too_large',max:SERVICE_PAYLOAD_LIMIT},413):answer({error:'evidence_unavailable'},503);}
 });
 /** A passed-through image refusal: one of the export door's codes at its own status, with only its detail fields. */
 const imageRefusal=async(response:Response):Promise<Response>=>{
  let told:Record<string,unknown>={};
  try{told=JSON.parse(await readBody(response,{limit:8192,as:'text'}));}catch{await response.body?.cancel().catch(()=>{});}
  const code=typeof told?.error==='string'?told.error:response.status===404?'not_found':'';
  if(!Object.hasOwn(ARTIFACT_IMAGE_ERRORS,code)||ARTIFACT_IMAGE_ERRORS[code]!==response.status)return answer({error:'image_unavailable'},503);
  return answer(Object.fromEntries(ARTIFACT_IMAGE_ERROR_FIELDS.filter(key=>key in told&&told[key]!==null&&typeof told[key]!=='object').map(key=>[key,told[key]]).concat([['error',code]])),response.status);
 };
 const imageOptions=(input:Record<string,unknown>)=>(input.format===undefined||input.format==='png'||input.format==='jpg')
  &&(input.element===undefined||typeof input.element==='string'&&input.element.length>0&&input.element.length<=ELEMENT_CAPTURE.selectorChars)
  &&(input.slide===undefined||Number.isSafeInteger(input.slide)&&Number(input.slide)>0);
 /**
  * Delegated canonical reads by an arg_ grant: issue (`{token}`), read (`{grant, artifact_id}`) and image (read's keys
  * plus `format?`, `element?`, `slide?`). One sequence for read and image: the grant and its live claims, the fixed app
  * seam as the grant's person, the answer buffered under SERVICE_PAYLOAD_LIMIT, the claims again, the canonical READ
  * seam's decision again (CURRENT ACL, after the answer was made), the claims again, then delivery. The image call is
  * bounded whole by ARTIFACT_IMAGE_DEADLINE_MS, a relay's request cut being above it.
  */
 for(const path of [ARTIFACT_READ_GRANT_PATH,ARTIFACT_READ_PATH,ARTIFACT_IMAGE_PATH])app.all(path,async c=>{
  const issuing=path===ARTIFACT_READ_GRANT_PATH,image=path===ARTIFACT_IMAGE_PATH;
  const signal=image?AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(ARTIFACT_IMAGE_DEADLINE_MS)]):undefined;
  const step=<T>(pending:Promise<T>):Promise<T>=>signal?evidenceStep(signal,pending):pending;
  const unavailable=image?'image_unavailable':'read_unavailable';
  let service:ServiceAudience|undefined;
  let input:Response|Record<string,unknown>;
  try{input=await step(admit(c,presented=>!!(service=serviceOf(audiences,presented))&&service.artifactReads===true));}catch{return answer({error:unavailable},503);}
  if(input instanceof Response)return input;
  const keys=issuing?['token']:['grant','artifact_id'],optional=image?['format','element','slide']:[];
  if(Object.keys(input).some(key=>!keys.includes(key)&&!optional.includes(key))||keys.some(key=>typeof input[key]!=='string'||!input[key])||image&&!imageOptions(input))return answer({error:'bad_request'},400);
  try{
   const claims=issuing?(tokenKey?verifyServiceToken(tokenKey,audiences,input.token as string):null):verifyArtifactReadGrant(grantKey,audiences,input.grant as string);
   const liveClaims=async()=>{signal?.throwIfAborted();return !!claims&&(issuing||claims.exp>Math.floor(Date.now()/1000))&&claims.svc===service!.id&&claims.aud===service!.origin&&await activeUser(claims.sub)&&await parentLive(claims.par,claims.sub)&&(!o.admitIdentity||await o.admitIdentity({userId:claims.sub}));};
   if(!await step(liveClaims())||!claims)return answer({error:'unauthorized'},401);
   if(issuing){const issued=signArtifactReadGrant(grantKey,service!,{userId:claims.sub,parent:claims.par});return answer({grant:issued.token,expires_at:issued.expiresAt,user_id:claims.sub,audience:claims.aud} satisfies IssuedArtifactReadGrant);}
   const id=input.artifact_id as string;
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))return answer({error:'bad_request'},400);
   const read=new Request(new URL(CANONICAL_ARTIFACT_READ_PATH+'?id='+encodeURIComponent(id),c.req.url),signal?{signal}:{});
   const first=image?new Request(new URL(CANONICAL_ARTIFACT_IMAGE_PATH,c.req.url),{method:'POST',signal,
    body:JSON.stringify({artifact_id:id,...Object.fromEntries(optional.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]))})}):read;
   const response=await step(o.upstream(first,{credential:'session',userId:claims.sub}));
   if(response.status!==200){if(image)return await step(imageRefusal(response));await response.body?.cancel();return answer({error:'not_found'},404);}
   const body=await step(readBody(response,{limit:SERVICE_PAYLOAD_LIMIT,as:'text'}));
   if(image&&typeof JSON.parse(body)?.data!=='string')return answer({error:unavailable},503);
   if(!await step(liveClaims()))return answer({error:'unauthorized'},401);
   // The app's second decision rechecks CURRENT ACL after the buffered answer.
   const checked=await step(o.upstream(read,{credential:'session',userId:claims.sub}));
   await checked.body?.cancel();
   if(checked.status!==200)return answer({error:'not_found'},404);
   if(!await step(liveClaims()))return answer({error:'unauthorized'},401);
   signal?.throwIfAborted();
   return new Response(body,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch(error){return error instanceof BodyTooLargeError?answer({error:'too_large',max:SERVICE_PAYLOAD_LIMIT},413):answer({error:unavailable},503);}
 });
 /**
  * A relay's chart drawing (contracts CHART_IMAGE_PATH): admitted like artifact-read (the service's own introspection
  * secret, `artifact_reads` opt-in), exact keys, no grant (drawing reads no data). The body goes to the fixed app seam as
  * the anonymous actor; its status and JSON come back buffered to at most SERVICE_PAYLOAD_LIMIT.
  */
 app.all(CHART_IMAGE_PATH,async c=>{
  let service:ServiceAudience|undefined;
  const input=await admit(c,presented=>!!(service=serviceOf(audiences,presented))&&service.artifactReads===true,SERVICE_PAYLOAD_LIMIT);
  if(input instanceof Response)return input;
  const keys=Object.keys(input);
  if(!keys.includes('chart')||!keys.includes('rows')||keys.some(key=>!(CHART_IMAGE_KEYS as readonly string[]).includes(key)))return answer({error:'bad_request'},400);
  try{
   const signal=AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(60000)]);
   const response=await o.upstream(new Request(new URL(CANONICAL_CHART_IMAGE_PATH,c.req.url),{method:'POST',body:JSON.stringify(input),signal}),ANONYMOUS);
   const body=await readBody(response,{limit:SERVICE_PAYLOAD_LIMIT,as:'text'});
   return new Response(body,{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch(error){return error instanceof BodyTooLargeError?answer({error:'too_large',max:SERVICE_PAYLOAD_LIMIT},413):answer({error:'render_unavailable'},503);}
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
  return createIdentityStore({db,authSchema,testDomain:testDomainSignInOf(o.env,()=>{})?.domain});
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
