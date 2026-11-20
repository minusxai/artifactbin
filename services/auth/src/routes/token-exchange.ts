/**
 * The two non-OAuth credential routes, `mountTokenExchange(app, o)`: `POST /api/authentication/token` (below) and
 * THE EXCHANGE (contracts `SERVICE_TOKEN_PATH`, `{"audience": "<id>"}`): a credential the caller already holds here, a
 * browser session (same Origin, as every cookie-borne write) or an ordinary API bearer, for a short-lived token for one
 * configured service (../identity/service-tokens, `parent` naming that credential), and no refresh token: the browser
 * page or agent asks again before it expires. A service token or an exchanged one is no bearer here, so none is
 * exchanged again. An agent signed in AS A GROUP exchanges its own API bearer the same way, for a service that opts in
 * (`group_principals`; otherwise 403 `GROUP_PRINCIPALS_NOT_ACCEPTED`): a group's service token (../identity/service-tokens
 * `signGroupServiceToken`), never past the group sign-in, which is read again here by the bearer read's own rule.
 */
import { ANONYMOUS, GROUP_PRINCIPALS_NOT_ACCEPTED, SERVICE_TOKEN_PATH, isGroupActor, isGroupPrincipalRole, type ServiceAudience, type ServiceTokenParent } from '@artifactbin/contracts';
import { ARTIFACT_SCOPE } from '../identity/oauth';
import { signGroupServiceToken, signServiceToken } from '../identity/service-tokens';
import type { LiveGroupSignIn } from '../identity/bearer';
import type { AuthApp } from '../parts';
import { GroupSignInRefused, NO_STORE, isSameOrigin, issueGrant, readAuthJson, resourceOf, type GrantGroup, type OAuthRoutesOptions } from './grants';

const refuse = (status: number, error: string, hint?: string) => new Response(JSON.stringify({ error, ...(hint ? { hint } : {}) }), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
const serviceById = (o: OAuthRoutesOptions, requested: unknown) => typeof requested === 'string' ? (o.serviceAudiences ?? []).find(entry => entry.id === requested) : undefined;

export function mountTokenExchange(app: AuthApp, o: OAuthRoutesOptions): void {
  /*
   * Direct integrations obtain a bearer from an email-verified session, without device/browser grants: a 24 h access
   * token and a 30-day refresh token, for a client outside any page (the skill's sign-in, curl, a server). A page's
   * script never receives one: a browser marks every request a page makes with `Sec-Fetch-Site` and `Sec-Fetch-Dest`,
   * which page code cannot remove, so a request carrying either is refused, and a page asks SERVICE_TOKEN_PATH for a
   * short-lived token instead. `Sec-Fetch-Mode` alone is NOT a page: Node's own fetch (the skill's sign-in) sends it.
   * The app's own pages never call this.
   */
  app.post('/api/authentication/token', async (c) => {
    if(['sec-fetch-site','sec-fetch-dest'].some(name=>c.req.header(name)!==undefined))
      return refuse(403,'page_context_refused',`A page uses POST ${SERVICE_TOKEN_PATH} for a short-lived token.`);
    const actor=c.get('actor') ?? ANONYMOUS;
    if(actor.credential!=='session'||!actor.userId||!actor.email||actor.emailVerified!==true)
      return refuse(401,'email_auth_required','Sign in using the email OTP endpoints first.');
    if(!isSameOrigin(o,c.req.raw))return refuse(403,'forbidden');
    // An optional {"audience":"<service id>"}: a grant for that configured service instead of this API; or
    // {"group_id","group_role"}: a GROUP's sign-in at this API, acting as that group at that level (header).
    const parsed=await readAuthJson(c.req.raw,{});
    if(parsed instanceof Response)return parsed;
    const body=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null;
    const requested=body?body.audience:null;
    const service=serviceById(o,requested);
    if(requested!==undefined&&!service)return refuse(400,'invalid_audience','Name a configured service id, or send no audience for this API.');
    let group:GrantGroup|null=null;
    if(body&&(body.group_id!==undefined||body.group_role!==undefined)){
      if(service||typeof body.group_id!=='string'||!body.group_id||!isGroupPrincipalRole(body.group_role))
        return refuse(400,'invalid_group_sign_in','Send group_id with group_role member or editor, and no audience.');
      group={id:body.group_id,role:body.group_role};
    }
    const scope=service?'':ARTIFACT_SCOPE;
    try{
      const client=await o.oauth.register({client_name:'artifactbin HTTP',redirect_uris:['http://127.0.0.1/callback']});
      const clientId=String(client.client_id);
      const resource=service?service.origin:resourceOf(o,c.req.raw);
      const {minted,refreshToken}=await issueGrant(o,c.req.raw,{clientId,userId:actor.userId,resource,scope,group});
      return new Response(JSON.stringify({has_created_document:minted.has_created_document,id:minted.id,access_token:minted.token,refresh_token:refreshToken,client_id:clientId,token_type:'Bearer',expires_in:minted.expiresIn,scope,resource,...(group?{group_id:group.id,group_role:group.role}:{})}),{status:201,headers:{'Content-Type':'application/json',...NO_STORE}});
    }catch(error){
      if(error instanceof GroupSignInRefused)return refuse(403,'group_level_not_held','Only someone holding at least that level on the group may sign an agent in as it.');
      return refuse(503,'temporarily_unavailable');
    }
  });
  /** The configured service a body's `audience` names (undefined: none), or the 413 for a body over the limit. */
  const serviceAsked=async(request:Request):Promise<ServiceAudience|undefined|Response>=>{
    const parsed=await readAuthJson(request);
    return parsed instanceof Response?parsed:serviceById(o,(parsed as {audience?:unknown}|null|undefined)?.audience);
  };
  app.post(SERVICE_TOKEN_PATH, async (c) => {
    const actor=c.get('actor') ?? ANONYMOUS;
    const issuedAnswer=(issued:{token:string;expiresAt:string},service:ServiceAudience)=>new Response(JSON.stringify({access_token:issued.token,token_type:'Bearer',expires_in:Math.round((Date.parse(issued.expiresAt)-Date.now())/1000),expires_at:issued.expiresAt,audience:service.id,resource:service.origin}),{status:200,headers:{'Content-Type':'application/json',...NO_STORE}});
    if(isGroupActor(actor)){
      // An agent signed in as a group (always a bearer): the group itself at that service, if the service opts in.
      const service=await serviceAsked(c.req.raw);
      if(service instanceof Response)return service;
      if(!service)return refuse(400,'invalid_audience','Name a configured service id.');
      if(service.groupPrincipals!==true)return refuse(403,GROUP_PRINCIPALS_NOT_ACCEPTED,'This service does not accept an agent signed in as a group.');
      if(!o.groupServiceTokenKey||!o.groupSignIns)return refuse(503,'temporarily_unavailable');
      // The sign-in again, by the bearer read's rule, and exactly the group, level and issuer the bearer named.
      let live:LiveGroupSignIn|null;
      try{live=await o.groupSignIns.live(actor.tokenId);}catch{return refuse(503,'temporarily_unavailable');}
      if(!live||live.groupId!==actor.principalGroupId||live.groupRole!==actor.principalGroupRole||live.issuedBy!==actor.issuedBy)
        return refuse(401,'authentication_required','The group sign-in is no longer live: sign in again.');
      let issued;
      try{issued=signGroupServiceToken(o.groupServiceTokenKey,service,{group:{id:live.groupId,role:live.groupRole,issuedBy:live.issuedBy},parent:{kind:'token',id:live.id},notAfter:live.expiresAt?Date.parse(live.expiresAt):null});}
      catch{return refuse(401,'authentication_required','The group sign-in is no longer live: sign in again.');}
      return issuedAnswer(issued,service);
    }
    const parent:ServiceTokenParent|null=actor.credential==='session'&&actor.sessionId?{kind:'session',id:actor.sessionId}:actor.credential==='bearer'&&actor.tokenId?{kind:'token',id:actor.tokenId}:null;
    if(!parent||!actor.userId)return refuse(401,'authentication_required','Send this host\'s own API bearer, or call from a signed-in page.');
    // A cookie is ambient: only this deployment's own pages may spend it here. A bearer is explicit and needs no Origin.
    if(parent.kind==='session'&&!isSameOrigin(o,c.req.raw))return refuse(403,'forbidden');
    const service=await serviceAsked(c.req.raw);
    if(service instanceof Response)return service;
    if(!service)return refuse(400,'invalid_audience','Name a configured service id.');
    if(!o.serviceTokenKey)return refuse(503,'temporarily_unavailable');
    // The same account rule as every grant here: a verified email account this deployment admits.
    const identity=await o.sessions.identity?.(actor.userId).catch(()=>null);
    if(!identity?.email||!identity.emailVerified||identity.userId!==actor.userId||(o.admitIdentity&&!await o.admitIdentity(identity)))return refuse(403,'deployment_admission_required');
    return issuedAnswer(signServiceToken(o.serviceTokenKey,service,{userId:actor.userId,parent}),service);
  });
}
