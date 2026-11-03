import {RESOLVER_LIMITS,type ResolverFetchReceipt,type ResolverSecretHosts,type RunnerJson} from '@artifactbin/contracts';
import {parseWebUrl,requestWebHop,WebIngestError,type WebIngestPolicy} from '@/lib/web-ingest';
import {redact,secretForms} from './redaction';
import {createGoogleTokenSource,GoogleAuthFailure,googleAuthOption,isGoogleApiHost,type GoogleAuth,type GoogleTokenSourceOptions} from './google-auth';
/** What `caps.fetch` answers. `receipt` is for the run receipt; the runner strips it before resolver code sees the rest. */
interface ResolverFetchResult {status:number;url:string;headers:Record<string,string>;body:string;receipt:ResolverFetchReceipt}
/** The pinned version's bindings, a reader for the owner's values and whose they are (it scopes cached Google tokens). Values never leave the host. */
interface ResolverSecrets {owner:string;resolver:string;hosts:ResolverSecretHosts;read(name:string):Promise<string>}
export type ResolverFetcher=(input:RunnerJson,secrets:ResolverSecrets,signal?:AbortSignal)=>Promise<ResolverFetchResult>;
/** A refusal or failure resolver code may see: a code and at most a fixed detail or a name, never a URL, header or value. */
export class ResolverFetchError extends Error {
 readonly code:string;
 constructor(code:string,detail?:string){super(detail?`${code}: ${detail}`:code);this.name='ResolverFetchError';this.code=code;}
}

const METHODS=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE']);
const OPTIONS=new Set(['url','method','headers','body','auth']);
/** The plan's list plus the remaining hop-by-hop headers. `accept-encoding` is always overridden to identity. */
const FORBIDDEN_HEADER=/^(?:host|cookie|content-length|transfer-encoding|connection|keep-alive|te|trailer|upgrade|expect|proxy-.*)$/;
const TOKEN=/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/;
const PLACEHOLDER=/\{\{([A-Z][A-Z0-9_]{0,63})\}\}/g;
const REDIRECTS=new Set([301,302,303,307,308]),MAX_REDIRECTS=3;
/** Room for the controller's message envelope under its line cap. */
const RESULT_BYTES=RESOLVER_LIMITS.messageBytes-4096;

/** Exact host, or any subdomain (at any depth) under one leading `*.` label; never the apex. */
export function secretHostAllows(binding:string,hostname:string):boolean{
 if(binding.startsWith('*.')){const suffix=binding.slice(1);return hostname.length>suffix.length&&hostname.endsWith(suffix);}
 return hostname===binding;
}
const fail=(code:string,detail?:string):never=>{throw new ResolverFetchError(code,detail);};
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const names=(text:string)=>[...text.matchAll(PLACEHOLDER)].map(m=>m[1]!);

interface Validated {url:string;method:string;headers:[string,string][];body?:string;auth?:GoogleAuth}
function validate(input:RunnerJson):Validated{
 if(!isObject(input))fail('invalid_request','options must be an object');
 const o=input as Record<string,unknown>;
 for(const key of Object.keys(o))if(!OPTIONS.has(key))fail('invalid_request','unknown option');
 if(typeof o.url!=='string'||o.url.length>8192)fail('invalid_request','url must be a string');
 const method=o.method===undefined?'GET':typeof o.method==='string'?o.method.toUpperCase():'';
 if(!METHODS.has(method))fail('invalid_request','method');
 const headers:[string,string][]=[];
 if(o.headers!==undefined){
  if(!isObject(o.headers))fail('invalid_request','headers must be an object');
  const entries=Object.entries(o.headers as Record<string,unknown>);
  if(entries.length>64)fail('invalid_request','too many headers');
  for(const [raw,value] of entries){
   const name=raw.toLowerCase();
   if(!TOKEN.test(name))fail('invalid_request','header name');
   if(FORBIDDEN_HEADER.test(name))fail('invalid_request',`forbidden header ${name}`);
   if(typeof value!=='string'||value.length>8192||/[\r\n\0]/.test(value))fail('invalid_request',`header ${name}`);
   if(headers.some(([n])=>n===name))fail('invalid_request',`duplicate header ${name}`);
   headers.push([name,value as string]);
  }
 }
 if(o.body!==undefined){
  if(typeof o.body!=='string')fail('invalid_request','body must be a string');
  if(method==='GET'||method==='HEAD')fail('invalid_request',`${method} has no body`);
  if(Buffer.byteLength(o.body as string)>RESOLVER_LIMITS.fetchRequestBodyBytes)fail('request_limit');
 }
 let auth:GoogleAuth|undefined;
 if(o.auth!==undefined){
  auth=googleAuthOption(o.auth)??fail('invalid_request','auth must be {type:\'google\', secret, scopes}');
  if(headers.some(([n])=>n==='authorization'))fail('invalid_request','auth and an authorization header');
 }
 return {url:o.url as string,method,headers,...(o.body===undefined?{}:{body:o.body as string}),...(auth?{auth}:{})};
}
const ingestCode=(code:string)=>code==='too_large'?'response_limit':code==='bad_status'||code==='unsupported_type'||code==='forbidden_host'?'fetch_failed':code;

/**
 * `caps.fetch`, performed by the app. `{{NAME}}` in the URL, header values or body is filled with the
 * owner's value only for a declared name whose bound host matches the request's host; anything else is refused
 * before a value is read or a socket opens. Every hop is vetted (scheme, port, credentials, literal and resolved
 * addresses); redirects are followed only for GET/HEAD carrying no secret. The response is redacted of every
 * value used, in its URL-encoded and base64 forms too, before it leaves this function.
 */
export function createResolverFetch(options:{policy?:WebIngestPolicy;timeoutMs?:number;google?:Omit<GoogleTokenSourceOptions,'policy'>&{hosts?:(hostname:string)=>boolean}}={}):ResolverFetcher{
 const policy=options.policy??{allowPrivate:false,allowHttp:false};
 const timeoutMs=options.timeoutMs??RESOLVER_LIMITS.fetchTimeoutMs;
 const {hosts:googleHosts=isGoogleApiHost,...googleOptions}=options.google??{};
 // One cache per fetcher, so the production singleton keeps tokens across requests.
 const google=createGoogleTokenSource({...googleOptions,policy});
 return async(input,secrets,signal)=>{
  const request=validate(input);
  let template:URL;
  try{template=new URL(request.url);}catch{return fail('invalid_url');}
  // A value in the authority would choose (or be leaked to) the destination itself.
  if([template.username,template.password,template.host].some(part=>/[{}]|%7b|%7d/i.test(part)))fail('secret_host_forbidden','placeholders belong in the path, query, headers or body');
  try{template=parseWebUrl(request.url,policy);}catch(e){return fail(e instanceof WebIngestError?ingestCode(e.code):'invalid_url');}
  const host=template.hostname;
  const placeholders=new Set([request.url,...request.headers.map(([,v])=>v),request.body??''].flatMap(names));
  const auth=request.auth;
  const used=[...new Set([...placeholders,...(auth?[auth.secret]:[])])].sort();
  for(const name of used){
   const binding=Object.hasOwn(secrets.hosts,name)?secrets.hosts[name]:undefined;
   if(binding===undefined)fail('unknown_secret',name);
   if(!secretHostAllows(binding!,host))fail('secret_host_forbidden',name);
  }
  // The bearer goes only to a Google API host, whatever the binding says.
  if(auth&&!googleHosts(host))fail('secret_host_forbidden',auth.secret);
  const values=new Map<string,string>();
  for(const name of used){
   let value:unknown;
   try{value=await secrets.read(name);}catch{return fail('secret_unavailable',name);}
   if(typeof value!=='string'||!value)fail('secret_unavailable',name);
   values.set(name,value as string);
  }
  const fill=(text:string,encode:(v:string)=>string=v=>v)=>text.replace(PLACEHOLDER,(_,name:string)=>encode(values.get(name)!));
  const headers:Record<string,string>={accept:'*/*','user-agent':'artifactbin-resolver/1'};
  for(const [name,value] of request.headers){const filled=fill(value);if(/[\r\n\0]/.test(filled))fail('invalid_request',`header ${name}`);headers[name]=filled;}
  headers['accept-encoding']='identity';
  const body=request.body===undefined?undefined:fill(request.body);
  if(body!==undefined&&Buffer.byteLength(body)>RESOLVER_LIMITS.fetchRequestBodyBytes)fail('request_limit');
  const follow=(request.method==='GET'||request.method==='HEAD')&&!used.length;
  const deadline=Date.now()+timeoutMs;
  let forms=secretForms([...values.values()]);
  try{
   if(auth){
    const token=await google.token({owner:secrets.owner,resolver:secrets.resolver,secret:auth.secret,scopes:auth.scopes},values.get(auth.secret)!,deadline);
    headers.authorization=`Bearer ${token}`;
    forms=secretForms([...values.values(),token]);
   }
   let url=parseWebUrl(fill(request.url,encodeURIComponent),policy);
   if(url.hostname!==host||url.port!==template.port)fail('secret_host_forbidden');
   for(let hop=0;;hop++){
    const res=await requestWebHop(url,{method:request.method,headers,...(body===undefined?{}:{body}),policy,signal,deadline,maxBytes:RESOLVER_LIMITS.fetchResponseBytes,readBody:status=>!(follow&&REDIRECTS.has(status))});
    const location=res.headers.location;
    if(follow&&REDIRECTS.has(res.status)&&location){
     if(hop>=MAX_REDIRECTS)fail('too_many_redirects');
     url=parseWebUrl(new URL(location,url).toString(),policy);
     continue;
    }
    const responseHeaders:Record<string,string>={};
    for(const [name,value] of Object.entries(res.headers)){
     if(value===undefined||name==='set-cookie'||name==='set-cookie2')continue;
     responseHeaders[name]=redact(Array.isArray(value)?value.join(', '):value,forms);
    }
    const result:ResolverFetchResult={status:res.status,url:redact(url.toString(),forms),headers:responseHeaders,body:redact(new TextDecoder().decode(res.bytes),forms),
     receipt:{method:request.method,host,path:template.pathname.replace(/%7B%7B([A-Z][A-Z0-9_]{0,63})%7D%7D/g,'{{$1}}'),bytesIn:res.bytes.length,bytesOut:body===undefined?0:Buffer.byteLength(body),secrets:used}};
    if(Buffer.byteLength(JSON.stringify(result))>RESULT_BYTES)fail('response_limit');
    return result;
   }
  }catch(e){
   if(e instanceof ResolverFetchError)throw e;
   if(e instanceof GoogleAuthFailure)throw new ResolverFetchError(e.code);
   // Ingest messages name the URL, which may carry a filled value: only the code crosses.
   throw new ResolverFetchError(e instanceof WebIngestError?ingestCode(e.code):'fetch_failed');
  }
 };
}
/** Strict production instance: HTTPS on 443 to public addresses, in every environment. */
export const fetchResolverResource=createResolverFetch();
