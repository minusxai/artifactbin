/**
 * Auth-owned RPC, mounted before browser/session resolution and the public internal-path refusal. Every route here
 * is service-authenticated (SERVICE_AUTH_HEADER carrying INTERNAL__SERVICE_SECRET) and refused without it:
 *  - session-live: is a human session still live (the pages sessions' revalidation);
 *  - identity introspection (contracts `IDENTITY_INTROSPECT_PATH`, cross-repository contract §2): a presented bearer
 *    is answered here from the one bearer read every API request is admitted by (token, OAuth family fence,
 *    identity). Every other identity fact MinusX reads from the shared `identity` views, not from here;
 *  - MinusX's job events (contracts `EVENTS_PUBLISH_PATH`, cross-repository contract §6): the durable publish onto
 *    this process's events service, accepting only `source: 'minusx'` job envelopes with a catalogued verb and the ids
 *    the feed authorizes on. 2xx only once stored; a storage failure is 503, so MinusX's outbox keeps the batch;
 *  - THE IDENTITY MODULE's calls (contracts `IDENTITY_CALL_PATH`, `IdentityService`): every write to users, tokens,
 *    handles, groups, memberships, invitations and the group mail outbox, run by the identity store
 *    (`./identity-store`) on `identityDb` (which must offer transactions: `identityDbOf(pool)`) against the app's
 *    tables (`appSchema`). `{method, input}` in; `{result}` or `{refused: {code, status, retry_after?, detail?}}` out,
 *    both 200; anything else (no transactional database, a failure) is 503 and the caller's call throws.
 */
import {API_RESOURCE_PATH,EVENT_VERBS,EVENTS_PUBLISH_MAX_BATCH,EVENTS_PUBLISH_PATH,HUMAN_SESSION_LIVE_PATH,IDENTITY_CALL_PATH,IDENTITY_SCHEMA,IDENTITY_INTROSPECT_PATH,IDENTITY_METHODS,IdentityError,SERVICE_AUTH_HEADER,parseAliasOrigins,type EventEnvelope,type IdentityIntrospectResponse,type IdentityMethod,type IdentityService,type Part,type TokenRecord,type TransactionalQueryable} from '@artifactbin/contracts';
import {BodyTooLargeError,readBody,serviceSecretMatches} from '@artifactbin/utils';
import type {Context} from 'hono';
import type {AuthEnv,AuthOptions} from './parts';
import {acceptedOriginsOf} from './routes/oauth';
import {readEnv} from './env';
import {testDomainSignInOf} from './config';
import {createIdentityStore,ensureIdentitySchema} from './identity-store';
const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256;
/** A job event as MinusX publishes it: the only envelope another product may put on this installation's feed. */
const isJobEnvelope=(v:unknown):v is EventEnvelope=>{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const e=v as Record<string,unknown>,payload=e.payload as Record<string,unknown>|null;
 return text(e.id)&&text(e.at)&&!Number.isNaN(Date.parse(e.at))&&e.source==='minusx'&&e.object_kind==='job'&&text(e.object_id)
  &&(EVENT_VERBS.job as readonly string[]).includes(e.verb as string)&&(e.subject_kind===null||e.subject_kind==='service')&&(e.subject_id===null||text(e.subject_id))
  &&!!payload&&typeof payload==='object'&&!Array.isArray(payload)&&text(payload.schedule_id)&&text(payload.occurrence_id)&&text(payload.group_id);
};
export function sessionAuthority(o:AuthOptions):Part<AuthEnv>{return {name:'sessionAuthority',mount:app=>{
 const secret=readEnv(o.env,'INTERNAL__SERVICE_SECRET');
 /** A refusal Response, or the parsed JSON object body. */
 const admit=async(c:Context<AuthEnv>,parse=true):Promise<Response|Record<string,unknown>>=>{
  if(c.req.method!=='POST')return answer({error:'method_not_allowed'},405);
  if(!serviceSecretMatches(c.req.header(SERVICE_AUTH_HEADER),secret))return answer({error:'unauthorized'},401);
  if(!parse)return {};
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
  * token for one of this deployment's API origins, and an ACTIVE account, by the one rule every reader applies (the
  * `users` read view's `active`, ./identity-store/views), read on this host's database. The record, or null.
  */
 const live=async(c:Context<AuthEnv>,token:TokenRecord|null):Promise<(TokenRecord&{userId:string})|null>=>{
  const userId=token?.userId;
  if(!token||!userId||!o.identityDb)return null;
  const origins=acceptedOriginsOf(c.req.raw,o.trustedHops??0,readEnv(o.env,'APP__PUBLIC_BASE_URL'),parseAliasOrigins(readEnv(o.env,'APP__ALIAS_ORIGINS')));
  if(token.audience&&!origins.some(origin=>token.audience===`${origin}${API_RESOURCE_PATH}`))return null;
  const active=(await o.identityDb.query<{active:boolean}>(`SELECT active FROM ${readSchema}.users WHERE id=$1`,[userId])).rows[0]?.active===true;
  return active?{...token,userId}:null;
 };
 app.all(IDENTITY_INTROSPECT_PATH,async c=>{
  const input=await admit(c);if(input instanceof Response)return input;
  if(typeof input.token!=='string'||!input.token)return answer({error:'bad_request'},400);
  let token:(TokenRecord&{userId:string})|null;
  try{token=await live(c,await o.tokens.byToken(input.token));}catch{return answer({error:'session_unavailable'},503);}
  if(!token)return answer({active:false} satisfies IdentityIntrospectResponse);
  return answer({active:true,user_id:token.userId,token_id:token.id,scopes:token.scope?.split(/\s+/).filter(Boolean)??[]} satisfies IdentityIntrospectResponse);
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
 app.all(EVENTS_PUBLISH_PATH,async c=>{
  const refused=await admit(c,false);if(refused instanceof Response)return refused;
  let batch:unknown;
  try{batch=JSON.parse(await readBody(c.req.raw,{limit:1<<20,as:'text'}));}catch(e){return answer({error:e instanceof BodyTooLargeError?'too_large':'bad_request'},e instanceof BodyTooLargeError?413:400);}
  if(!Array.isArray(batch)||batch.length>EVENTS_PUBLISH_MAX_BATCH||!batch.every(isJobEnvelope))return answer({error:'bad_request'},400);
  if(!o.events?.publish)return answer({error:'events_unavailable'},503);
  try{await o.events.publish(batch);}catch{return answer({error:'events_unavailable'},503);}
  return answer({accepted:batch.length});
 });
}};}
