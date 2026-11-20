/**
 * THE DOOR every auth-owned RPC route (./session-authority, ./token-authority) is entered by: `authorityConfig(o)` reads
 * its settings once (the installation's service secret, the configured services, the signing keys and the schemas);
 * `admitService(c, admitted, limit)` refuses anything but a POST carrying a credential `admitted` accepts and a JSON
 * object body within `limit`, and answers that body; `serviceOf` is the configured service whose own introspection
 * secret a caller presented (compared in constant time); `answer` is every route's JSON reply.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {IDENTITY_SCHEMA} from '@artifactbin/contracts/identity-service';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';
import {parseServiceAudiences, type ServiceAudience} from '@artifactbin/contracts/service-audiences';
import {BodyTooLargeError, readBody} from '@artifactbin/utils/body';
import type {Context} from 'hono';
import type {AuthEnv,AuthOptions} from './parts';
import {readEnv} from './env';
import {groupServiceTokenKey,serviceTokenKey} from './identity/service-tokens';

export const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
/** The configured service whose introspection secret `presented` is, compared in constant time; undefined when none. */
export const serviceOf=(audiences:readonly ServiceAudience[],presented:string|undefined):ServiceAudience|undefined=>{
 if(!presented)return undefined;
 const digest=Buffer.from(sha256(presented));
 return audiences.find(service=>!!service.introspectionSecretSha256&&timingSafeEqual(Buffer.from(service.introspectionSecretSha256),digest));
};

/** A refusal Response, or the parsed JSON object body. `admitted` decides the credential. */
export const admitService=async(c:Context<AuthEnv>,admitted:(presented:string|undefined)=>boolean,limit=8192):Promise<Response|Record<string,unknown>>=>{
 if(c.req.method!=='POST')return answer({error:'method_not_allowed'},405);
 if(!admitted(c.req.header(SERVICE_AUTH_HEADER)))return answer({error:'unauthorized'},401);
 let body:unknown;
 try{body=JSON.parse(await readBody(c.req.raw,{limit,as:'text'}));}catch(e){return e instanceof BodyTooLargeError?answer({error:'too_large',max:limit},413):answer({error:'bad_request'},400);}
 return body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:answer({error:'bad_request'},400);
};

export interface AuthorityConfig {
 /** INTERNAL__SERVICE_SECRET: the installation's own credential. */
 secret:string|undefined;
 /** IDENTITY__SERVICE_AUDIENCES. */
 audiences:readonly ServiceAudience[];
 /** The exchanged tokens' signing keys (of AUTH__SECRET), or null without one. */
 tokenKey:Buffer|null;
 groupKey:Buffer|null;
 authSchema:string;
 /** IDENTITY__SCHEMA, the identity read views; a plain lowercase identifier or the boot stops. */
 readSchema:string;
}
export function authorityConfig(o:AuthOptions):AuthorityConfig{
 const secret=readEnv(o.env,'INTERNAL__SERVICE_SECRET');
 // A key a removed feature used is ignored with one line at boot (contracts service-audiences `REMOVED_SERVICE_AUDIENCE_KEYS`), never its value.
 const audiences=parseServiceAudiences(readEnv(o.env,'IDENTITY__SERVICE_AUDIENCES'),(id,keys)=>console.warn(`[identity] IDENTITY__SERVICE_AUDIENCES entry ${JSON.stringify(id)} carries ${keys.join(', ')}, which this release no longer has: ignored`));
 const tokenKey=o.cookieSecret?serviceTokenKey(o.cookieSecret):null;
 const groupKey=o.cookieSecret?groupServiceTokenKey(o.cookieSecret):null;
 const authSchema=readEnv(o.env,'AUTH__SCHEMA')??'auth',readSchema=readEnv(o.env,'IDENTITY__SCHEMA')??IDENTITY_SCHEMA;
 if(!/^[a-z_][a-z0-9_]*$/.test(readSchema))throw Error(`IDENTITY__SCHEMA ${JSON.stringify(readSchema)} is not a plain lowercase identifier`);
 return {secret,audiences,tokenKey,groupKey,authSchema,readSchema};
}
