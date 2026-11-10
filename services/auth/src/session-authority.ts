/**
 * Auth-owned RPC, mounted before browser/session resolution and the public internal-path refusal. Every route here
 * is service-authenticated (SERVICE_AUTH_HEADER carrying INTERNAL__SERVICE_SECRET) and refused without it:
 *  - session-live: is a human session still live (the pages sessions' revalidation);
 *  - the identity endpoints (contracts `IDENTITY_PATHS`, cross-repository contract §2): `introspect` is answered
 *    here from the one bearer read every API request is admitted by (token, OAuth family fence, identity); `resolve`
 *    and `groups` are relayed to the application, which owns accounts and groups, and which checks the secret again.
 */
import {ANONYMOUS,API_RESOURCE_PATH,HUMAN_SESSION_LIVE_PATH,IDENTITY_PATHS,SERVICE_AUTH_HEADER,parseAliasOrigins,type IdentityIntrospectResponse,type Part} from '@artifactbin/contracts';
import {BodyTooLargeError,readBody,serviceSecretMatches} from '@artifactbin/utils';
import type {Context} from 'hono';
import type {AuthEnv,AuthOptions} from './parts';
import {acceptedOriginsOf} from './routes/oauth';
import {readEnv} from './env';
const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
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
 app.all(IDENTITY_PATHS.introspect,async c=>{
  const input=await admit(c);if(input instanceof Response)return input;
  if(typeof input.token!=='string'||!input.token)return answer({error:'bad_request'},400);
  let token;
  try{token=await o.tokens.byToken(input.token);}catch{return answer({error:'session_unavailable'},503);}
  // An OAuth access token is this deployment's API capability: its audience must be one of this deployment's origins.
  const origins=acceptedOriginsOf(c.req.raw,o.trustedHops??0,readEnv(o.env,'APP__PUBLIC_BASE_URL'),parseAliasOrigins(readEnv(o.env,'APP__ALIAS_ORIGINS')));
  const fits=!!token?.userId&&(!token.audience||origins.some(origin=>token.audience===`${origin}${API_RESOURCE_PATH}`));
  if(!token?.userId||!fits||(o.admitIdentity&&!await o.admitIdentity({userId:token.userId})))return answer({active:false} satisfies IdentityIntrospectResponse);
  return answer({active:true,user_id:token.userId,token_id:token.id,scopes:token.scope?.split(/\s+/).filter(Boolean)??[]} satisfies IdentityIntrospectResponse);
 });
 // The application answers these; this host only refuses a caller without the secret before relaying it.
 for(const path of [IDENTITY_PATHS.resolve,IDENTITY_PATHS.groups])app.all(path,async c=>{
  const refused=await admit(c,false);if(refused instanceof Response)return refused;
  return o.upstream(c.req.raw,ANONYMOUS);
 });
}};}
