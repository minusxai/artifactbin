/**
 * WHAT A PRESENTED TOKEN IS, for a service: `mountTokenAuthority(app, o, config)` mounts identity introspection
 * (contracts `IDENTITY_INTROSPECT_PATH`), the RUN SIGN-IN (`RUN_SIGN_IN_PATH`) and a service's GROUP SIGN-IN with its
 * list of approvals (`GROUP_SIGN_IN_PATH`, `GROUP_SIGN_IN_GRANTS_PATH`), each as ./session-authority's header says.
 * An access token is live by the one bearer read (and must be bound to this API or a configured service); an exchanged
 * token by its signature and its parent credential's `live`; a group's exchanged token by its live group sign-in.
 * Every kind needs an ACTIVE account.
 */
import {ARTIFACT_SCOPE,DEFAULT_TOKEN_TTL_MS,MAX_TOKEN_TTL_MS,MIN_TOKEN_TTL_MS,RUN_SIGN_IN_PATH,GROUP_SIGN_IN_PATH,GROUP_SIGN_IN_GRANTS_PATH,SERVICE_GROUP_SIGN_IN_MAX_TTL_MS,type GroupSignIn,type RunSignIn} from '@artifactbin/contracts';
import {API_RESOURCE_PATH,IDENTITY_INTROSPECT_PATH,IdentityError,SERVICE_AUTH_HEADER,parseAliasOrigins,type IdentityIntrospectResponse,type ServiceAudience,type ServiceTokenParent,type TokenRecord} from '@artifactbin/contracts';
import {serviceSecretMatches} from '@artifactbin/utils';
import type {Context, Hono} from 'hono';
import type {AuthEnv,AuthOptions} from './parts';
import {acceptedOriginsOf,baseUrlOf} from './routes/grants';
import {listServiceGroupSignInGrants,mintRunSignIn,mintServiceGroupSignIn} from './identity-store/accounts';
import {identityTables} from './identity-store/tables';
import {say} from './events';
import {readEnv} from './env';
import {isGroupServiceToken,isServiceToken,verifyGroupServiceToken,verifyServiceToken} from './identity/service-tokens';
import {readLiveGroupSignIn} from './identity/bearer';
import {admitService,answer,serviceOf,type AuthorityConfig} from './authority-door';

/** A person's token: no group principal. */
const PERSON={group_id:null,group_role:null,issued_by:null} as const;
/** The lifetime a run sign-in asks for (`expires_in`, seconds; absent: the default), clamped to the token bounds; null when malformed. */
const runLifetime=(asked:unknown):number|null=>asked===undefined?DEFAULT_TOKEN_TTL_MS
 :typeof asked==='number'&&Number.isFinite(asked)&&asked>0?Math.min(MAX_TOKEN_TTL_MS,Math.max(MIN_TOKEN_TTL_MS,Math.round(asked*1000))):null;
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
  ?`SELECT live FROM ${readSchema}.tokens WHERE id=$1 AND user_id=$2`:`SELECT live FROM ${readSchema}.sessions WHERE id=$1 AND "userId"=$2`,[parent.id,userId])).rows[0]?.live===true;
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
    const parent=await readLiveGroupSignIn({db:o.identityDb,readSchema,serviceAudiences:audiences},claims.par.id);
    if(!parent||parent.groupId!==claims.grp||parent.groupRole!==claims.rol||parent.issuedBy!==claims.isb)return inactive;
    return answer({active:true,principal_kind:'group',user_id:null,token_id:claims.jti,scopes:[],audience:claims.aud,expires_at:new Date(claims.exp*1000).toISOString(),parent:claims.par,group_id:claims.grp,group_role:claims.rol,issued_by:claims.isb} satisfies IdentityIntrospectResponse);
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
  const input=await admitService(c,()=>true);if(input instanceof Response)return input;
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
 app.all(GROUP_SIGN_IN_PATH,async(c,next)=>{
  // Only a service that opted in, presenting its own secret, reaches this route; anyone else meets an unknown path.
  const service=serviceOf(audiences,c.req.header(SERVICE_AUTH_HEADER));
  if(!service?.groupSignIns)return next();
  const input=await admitService(c,()=>true);if(input instanceof Response)return input;
  if(Object.keys(input).some(key=>key!=='grant_id'&&key!=='expires_in')||typeof input.grant_id!=='string'||!/^sgg_[a-z0-9]{1,40}$/.test(input.grant_id))return answer({error:'bad_request'},400);
  // A run sign-in's lifetime (default six hours), clamped to a day: the service asks again, under a live approval.
  const asked=runLifetime(input.expires_in);
  if(asked===null)return answer({error:'invalid_expiry'},400);
  const lifetime=Math.min(asked,SERVICE_GROUP_SIGN_IN_MAX_TTL_MS);
  if(!o.identityDb)return answer({error:'session_unavailable'},503);
  try{
   const server=baseUrlOf(c.req.raw,o.trustedHops??0,readEnv(o.env,'APP__PUBLIC_BASE_URL'));
   const minted=await mintServiceGroupSignIn(identityTables(authSchema),o.identityDb,{grantId:input.grant_id,service:service.id,origin:service.origin,expiresInMs:lifetime,audience:`${server}${API_RESOURCE_PATH}`,scope:ARTIFACT_SCOPE});
   void say(o.events,{kind:'group',id:minted.groupId},'minted',{kind:'token',id:minted.id},{name:minted.name,group_id:minted.groupId,grant_id:input.grant_id,service:service.id});
   const expiresAt=minted.expiresAt!;
   return answer({access_token:minted.token,token_type:'Bearer',token_id:minted.id,expires_at:expiresAt,expires_at_ms:Date.parse(expiresAt),server,group_id:minted.groupId,group_role:minted.role,grant_id:input.grant_id} satisfies GroupSignIn);
  }catch(error){
   if(error instanceof IdentityError)return answer({error:error.code,...(error.retryAfter!==undefined?{retry_after:error.retryAfter}:{})},error.status);
   return answer({error:'session_unavailable'},503);
  }
 });
 app.all(GROUP_SIGN_IN_GRANTS_PATH,async(c,next)=>{
  // The same door as the sign-in route: only a service that opted in, with its own secret; anyone else, an unknown path.
  const service=serviceOf(audiences,c.req.header(SERVICE_AUTH_HEADER));
  if(!service?.groupSignIns)return next();
  const input=await admitService(c,()=>true);if(input instanceof Response)return input;
  // It takes no question: what it lists is the caller's own, never another service's or a chosen group's.
  if(Object.keys(input).length)return answer({error:'bad_request'},400);
  if(!o.identityDb)return answer({error:'session_unavailable'},503);
  try{return answer({approvals:await listServiceGroupSignInGrants(identityTables(authSchema),o.identityDb,{service:service.id,origin:service.origin})});}
  catch{return answer({error:'session_unavailable'},503);}
 });
}
