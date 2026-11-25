/**
 * WHAT A PRESENTED TOKEN IS, for a service: `mountTokenAuthority(app, o, config)` mounts identity introspection
 * (contracts `IDENTITY_INTROSPECT_PATH`), personal, interactive grant and scheduled RUN SIGN-IN and a service's GROUP SIGN-IN with its
 * list of approvals (`GROUP_SIGN_IN_PATH`, `GROUP_SIGN_IN_GRANTS_PATH`), each as ./session-authority's header says.
 * An access token is live by the one bearer read (and must be bound to this API or a configured service); an exchanged
 * token by its signature and its parent credential's `live`; a group's exchanged token by its live group sign-in.
 * Every kind needs an ACTIVE account.
 */
import {ARTIFACT_SCOPE} from '@artifactbin/contracts/cli-auth';
import {DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS, MIN_TOKEN_TTL_MS} from '@artifactbin/contracts/handles';
import { CHAT_SIGN_IN_PATH, RUN_SIGN_IN_PATH, SCHEDULE_SIGN_IN_PATH, GROUP_SIGN_IN_PATH, GROUP_SIGN_IN_GRANTS_PATH, type GroupSignIn, type RunSignIn } from '@artifactbin/contracts/service-audiences';
import {API_RESOURCE_PATH} from '@artifactbin/contracts/cli-auth';
import {IDENTITY_INTROSPECT_PATH, type IdentityIntrospectResponse} from '@artifactbin/contracts/identity-service';
import {IdentityError} from '@artifactbin/contracts/identity-module';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import {parseAliasOrigins} from '@artifactbin/contracts/server-identity';
import type {ServiceAudience, ServiceTokenParent} from '@artifactbin/contracts/service-audiences';
import type {TokenRecord} from '@artifactbin/contracts/identity';
import type {Context, Hono, Next} from 'hono';
import type {AuthEnv,AuthOptions} from './parts';
import {acceptedOriginsOf,baseUrlOf} from './routes/grants';
import {listServiceGroupSignInGrants,mintRunSignIn,mintServiceGroupSignIn} from './identity-store/accounts';
import {recordInteractiveConsent,revokeInteractiveConsent} from './identity-store/interactive-consent';
import {readScheduleConsent,recordScheduleConsent,revokeScheduleConsent} from './identity-store/schedule-consent';
import {identityTables} from './identity-store/tables';
import {say} from './events';
import {readEnv} from './env';
import {isGroupServiceToken,isServiceToken,verifyGroupServiceToken,verifyServiceToken} from './identity/service-tokens';
import {readLiveGroupSignIn} from './identity/bearer';
import {admitService,answer,serviceOf,type AuthorityConfig} from './authority-door';
import { SERVICE_GROUP_SIGN_IN_MAX_TTL_MS } from './identity-store/accounts';
import { timingSafeEqual } from 'node:crypto';

/**
 * Does `presented` (the SERVICE_AUTH_HEADER value) carry `expected`, the INTERNAL__SERVICE_SECRET? Constant time;
 * an unset or empty secret matches nothing, so a deployment without one refuses every service call.
 */
export function serviceSecretMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  const given = Buffer.from(presented ?? ''), wanted = Buffer.from(expected ?? '');
  return wanted.length > 0 && given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** A person's token: no group principal. */
const PERSON={group_id:null,group_role:null,issued_by:null} as const;
/** The lifetime a run sign-in asks for (`expires_in`, seconds; absent: the default), clamped to the token bounds; null when malformed. */
const runLifetime=(asked:unknown):number|null=>asked===undefined?DEFAULT_TOKEN_TTL_MS
 :typeof asked==='number'&&Number.isFinite(asked)&&asked>0?Math.min(MAX_TOKEN_TTL_MS,Math.max(MIN_TOKEN_TTL_MS,Math.round(asked*1000))):null;
const sessionUnavailable=()=>answer({error:'session_unavailable'},503);
export function mountTokenAuthority(app:Hono<AuthEnv>,o:AuthOptions,{secret,audiences,tokenKey,groupKey,authSchema,readSchema}:AuthorityConfig):void{
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
  ?`SELECT live FROM ${readSchema}.tokens WHERE id=$1 AND group_id IS NULL AND user_id=$2`:`SELECT live FROM ${readSchema}.sessions WHERE id=$1 AND "userId"=$2`,[parent.id,userId])).rows[0]?.live===true;
 const serverOf=(c:Context<AuthEnv>)=>baseUrlOf(c.req.raw,o.trustedHops??0,readEnv(o.env,'APP__PUBLIC_BASE_URL'));
 const verifiedServiceParent=async(token:string,service:ServiceAudience)=>{
  const claims=isServiceToken(token)&&tokenKey?verifyServiceToken(tokenKey,audiences,token):null;
  if(!claims||claims.svc!==service.id||claims.aud!==service.origin||!await activeUser(claims.sub)||!await parentLive(claims.par,claims.sub)
    ||(o.admitIdentity&&!await o.admitIdentity({userId:claims.sub})))throw new IdentityError('unauthorized',401);
  if(claims.par.kind==='token'&&(await o.identityDb!.query<{issued_by:string|null}>(`SELECT issued_by FROM ${readSchema}.tokens WHERE id=$1`,[claims.par.id])).rows[0]?.issued_by)
   throw new IdentityError('parent_not_eligible',403);
  return claims;
 };
 const respondRun=(minted:Awaited<ReturnType<typeof mintRunSignIn>>,server:string,userId:string)=>{
  void say(o.events,{kind:'user',id:userId},'minted',{kind:'token',id:minted.id},{name:minted.name});
  const expiresAt=minted.expiresAt!;
  return answer({access_token:minted.token,token_type:'Bearer',token_id:minted.id,expires_at:expiresAt,expires_at_ms:Date.parse(expiresAt),server} satisfies RunSignIn);
 };
 const signInError=(error:unknown)=>error instanceof IdentityError
  ?answer({error:error.code,...(error.retryAfter!==undefined?{retry_after:error.retryAfter}:{})},error.status)
  :sessionUnavailable();
 // Match the service and its opt-in before inspecting the request: a closed route falls through as an unknown path.
 const serviceRoute=(optIn:'runSignIns'|'groupSignIns',
  handle:(input:Record<string,unknown>,service:ServiceAudience,c:Context<AuthEnv>)=>Promise<Response>,
  onError:(error:unknown)=>Response=signInError,
 )=>async(c:Context<AuthEnv>,next:Next)=>{
  const service=serviceOf(audiences,c.req.header(SERVICE_AUTH_HEADER));
  if(!service?.[optIn])return next();
  const input=await admitService(c,()=>true);if(input instanceof Response)return input;
  try{return await handle(input,service,c);}catch(error){return onError(error);}
 };
 app.all(IDENTITY_INTROSPECT_PATH,async c=>{
  // The installation itself (every token), or one configured service (only tokens bound to its own origin).
  const asker:{only:ServiceAudience|null}={only:null};
  const input=await admitService(c,presented=>serviceSecretMatches(presented,secret)||!!(asker.only=serviceOf(audiences,presented)??null));if(input instanceof Response)return input;
  const only=asker.only;
  if(typeof input.token!=='string'||!input.token)return answer({error:'bad_request'},400);
  const inactive=answer({active:false} satisfies IdentityIntrospectResponse);
  try{
   if(isServiceToken(input.token)){
    const claims=tokenKey?verifyServiceToken(tokenKey,audiences,input.token):null;
    if(!claims||(only&&claims.aud!==only.origin)||!await activeUser(claims.sub)||!await parentLive(claims.par,claims.sub))return inactive;
    return answer({active:true,principal_kind:'user',user_id:claims.sub,token_id:claims.jti,scopes:[],audience:claims.aud,expires_at:new Date(claims.exp*1000).toISOString(),parent:claims.par,...PERSON} satisfies IdentityIntrospectResponse);
   }
   if(isGroupServiceToken(input.token)){
    const claims=groupKey?verifyGroupServiceToken(groupKey,audiences,input.token):null;
    if(!claims||(only&&claims.aud!==only.origin)||!o.identityDb)return inactive;
    const parent=await readLiveGroupSignIn({db:o.identityDb,authSchema,readSchema,serviceAudiences:audiences},claims.par.id);
    if(!parent||parent.groupId!==claims.grp||parent.groupRole!==claims.rol||parent.issuedBy!==claims.isb)return inactive;
    if(parent.interactiveService&&(parent.interactiveService.id!==claims.svc||parent.interactiveService.origin!==claims.aud))return inactive;
    return answer({active:true,principal_kind:'group',user_id:parent.auditUserId,token_id:claims.jti,scopes:[],audience:claims.aud,expires_at:new Date(claims.exp*1000).toISOString(),parent:claims.par,group_id:claims.grp,group_role:claims.rol,issued_by:claims.isb} satisfies IdentityIntrospectResponse);
   }
   const token=await live(c,await o.tokens.byToken(input.token));
   if(!token||(only&&token.audience!==only.origin))return inactive;
   if(token.groupId&&token.groupRole&&token.issuedBy)return answer({active:true,principal_kind:'group',user_id:token.auditUserId??null,token_id:token.id,scopes:token.scope?.split(/\s+/).filter(Boolean)??[],audience:token.audience??null,expires_at:token.expiresAt??null,parent:null,group_id:token.groupId,group_role:token.groupRole,issued_by:token.issuedBy} satisfies IdentityIntrospectResponse);
   return answer({active:true,principal_kind:'user',user_id:token.userId!,token_id:token.id,scopes:token.scope?.split(/\s+/).filter(Boolean)??[],audience:token.audience??null,expires_at:token.expiresAt??null,parent:null,...PERSON,issued_by:token.issuedBy??null} satisfies IdentityIntrospectResponse);
  }catch{return sessionUnavailable();}
 });
 app.all(RUN_SIGN_IN_PATH,serviceRoute('runSignIns',async(input,service,c)=>{
  if(Object.keys(input).some(key=>!['token','expires_in','group_id','group_role'].includes(key))||typeof input.token!=='string'||!input.token)return answer({error:'bad_request'},400);
  const groupId=input.group_id;
  if((groupId!==undefined||input.group_role!==undefined)&&(typeof groupId!=='string'||!/^grp_[a-z0-9]+$/.test(groupId)||input.group_role!=='member'))return answer({error:'bad_request'},400);
  const lifetime=runLifetime(input.expires_in);
  if(lifetime===null)return answer({error:'invalid_expiry'},400);
  const claims=await verifiedServiceParent(input.token,service);
  const server=serverOf(c);
  const minted=await mintRunSignIn(identityTables(authSchema),o.identityDb!,authSchema,readSchema,{groupId:typeof groupId==='string'?groupId:null,userId:claims.sub,service:service.id,parent:claims.par,expiresInMs:lifetime,audience:`${server}${API_RESOURCE_PATH}`,scope:ARTIFACT_SCOPE});
  return respondRun(minted,server,claims.sub);
 }));
 app.all(SCHEDULE_SIGN_IN_PATH,serviceRoute('runSignIns',async(input,service,c)=>{
  const {action,schedule_id:id,revision,token,group_id:groupId,grant_id:grantId}=input;
  const fields=action==='consent'?['token','group_id']:action==='issue'?['grant_id','expires_in']:action==='revoke'?['grant_id']:null;
  if(!fields||Object.keys(input).some(key=>!['action','schedule_id','revision',...fields].includes(key))
    ||typeof id!=='string'||!id.trim()||id.length>256||typeof revision!=='string'||!revision.trim()||revision.length>256)
   return answer({error:'bad_request'},400);
  const db=o.identityDb;
  if(!db)return sessionUnavailable();
  const target={service,id,revision};
  if(action==='consent'){
   if(typeof token!=='string'||!token||typeof groupId!=='string'||!/^grp_[a-z0-9]+$/.test(groupId))return answer({error:'bad_request'},400);
   const claims=await verifiedServiceParent(token,service);
   return answer(await recordScheduleConsent(db,authSchema,readSchema,{...target,userId:claims.sub,groupId}));
  }
  if(typeof grantId!=='string'||!/^scg_[a-z0-9]{1,40}$/.test(grantId))return answer({error:'bad_request'},400);
  const grant={...target,grantId};
  if(action==='revoke'){
   await revokeScheduleConsent(db,authSchema,grant);
   return answer({ok:true});
  }
  const lifetime=runLifetime(input.expires_in);
  if(lifetime===null)return answer({error:'invalid_expiry'},400);
  const owner=await readScheduleConsent(db,authSchema,grant);
  if(o.admitIdentity&&!await o.admitIdentity({userId:owner.subject_id}))return answer({error:'grant_refused'},403);
  const server=serverOf(c);
  const minted=await mintRunSignIn(identityTables(authSchema),db,authSchema,readSchema,{
   groupId:owner.group_id,userId:owner.subject_id,service:service.id,parent:{kind:'schedule',id:grantId,origin:service.origin,scheduleId:id,revision},
   expiresInMs:Math.min(lifetime,SERVICE_GROUP_SIGN_IN_MAX_TTL_MS),audience:`${server}${API_RESOURCE_PATH}`,scope:ARTIFACT_SCOPE,
  });
  return respondRun(minted,server,owner.subject_id);
 }));
 app.all(CHAT_SIGN_IN_PATH,serviceRoute('runSignIns',async(input,service,c)=>{
  const {action,chat_id:contextId,group_id:groupId,token,grant_id:grantId}=input;
  const fields=action==='consent'?['token','group_role']:action==='issue'?['token','grant_id','expires_in']:action==='revoke'?['grant_id']:null;
  if(!fields||Object.keys(input).some(key=>!['action','chat_id','group_id',...fields].includes(key))
    ||typeof contextId!=='string'||!contextId.trim()||contextId.length>256
    ||typeof groupId!=='string'||!/^grp_[a-z0-9]+$/.test(groupId))return answer({error:'bad_request'},400);
  const db=o.identityDb;
  if(!db)return sessionUnavailable();
  const target={service,contextId,groupId};
  if(action==='consent'){
   if(input.group_role!=='admin'||typeof token!=='string'||!token)return answer({error:'bad_request'},400);
   const claims=await verifiedServiceParent(token,service);
   return answer(await recordInteractiveConsent(db,authSchema,readSchema,{...target,userId:claims.sub,parent:claims.par}));
  }
  if(typeof grantId!=='string'||!/^icg_[a-z0-9]{1,40}$/.test(grantId))return answer({error:'bad_request'},400);
  if(action==='revoke'){
   await revokeInteractiveConsent(db,authSchema,{...target,grantId});
   return answer({ok:true});
  }
  const lifetime=runLifetime(input.expires_in);
  if(lifetime===null)return answer({error:'invalid_expiry'},400);
  if(typeof token!=='string'||!token)return answer({error:'bad_request'},400);
  const claims=await verifiedServiceParent(token,service);
  const server=serverOf(c);
  const minted=await mintRunSignIn(identityTables(authSchema),db,authSchema,readSchema,{
   groupId,userId:claims.sub,service:service.id,parent:{kind:'interactive',id:grantId,origin:service.origin,contextId,personal:claims.par},
   expiresInMs:Math.min(lifetime,SERVICE_GROUP_SIGN_IN_MAX_TTL_MS),audience:`${server}${API_RESOURCE_PATH}`,scope:ARTIFACT_SCOPE,
  });
  return respondRun(minted,server,claims.sub);
 }));
 app.all(GROUP_SIGN_IN_PATH,serviceRoute('groupSignIns',async(input,service,c)=>{
  if(Object.keys(input).some(key=>key!=='grant_id'&&key!=='expires_in')||typeof input.grant_id!=='string'||!/^sgg_[a-z0-9]{1,40}$/.test(input.grant_id))return answer({error:'bad_request'},400);
  // A run sign-in's lifetime (default six hours), clamped to a day: the service asks again, under a live approval.
  const asked=runLifetime(input.expires_in);
  if(asked===null)return answer({error:'invalid_expiry'},400);
  const lifetime=Math.min(asked,SERVICE_GROUP_SIGN_IN_MAX_TTL_MS);
  if(!o.identityDb)return sessionUnavailable();
  const server=serverOf(c);
  const minted=await mintServiceGroupSignIn(identityTables(authSchema),o.identityDb,{grantId:input.grant_id,service:service.id,origin:service.origin,expiresInMs:lifetime,audience:`${server}${API_RESOURCE_PATH}`,scope:ARTIFACT_SCOPE});
  void say(o.events,{kind:'group',id:minted.groupId},'minted',{kind:'token',id:minted.id},{name:minted.name,group_id:minted.groupId,grant_id:input.grant_id,service:service.id});
  const expiresAt=minted.expiresAt!;
  return answer({access_token:minted.token,token_type:'Bearer',token_id:minted.id,expires_at:expiresAt,expires_at_ms:Date.parse(expiresAt),server,group_id:minted.groupId,group_role:minted.role,grant_id:input.grant_id} satisfies GroupSignIn);
 }));
 app.all(GROUP_SIGN_IN_GRANTS_PATH,serviceRoute('groupSignIns',async(input,service)=>{
  // It takes no question: what it lists is the caller's own, never another service's or a chosen group's.
  // Any failed listing is an availability failure. The sign-in route reports specific approval refusals.
  if(Object.keys(input).length)return answer({error:'bad_request'},400);
  if(!o.identityDb)return sessionUnavailable();
  return answer({approvals:await listServiceGroupSignInGrants(identityTables(authSchema),o.identityDb,{service:service.id,origin:service.origin})});
 },sessionUnavailable));
}
