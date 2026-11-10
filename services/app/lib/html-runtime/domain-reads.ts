import {DOMAIN_READ_ONLY_MESSAGE} from '@artifactbin/contracts/domain-footer';
import {RemoteUnreachable,type RemotePort} from './apollo/apollo-contracts';
import type {FunctionCaller} from './fn-fetch';
/**
 * A page served on a anonymous owner host (server/user-host), or as the exporter's capture (document-serving/raw), is a
 * top-level sandboxed page with no app frame, so the frame relay never attaches. Its reads go straight to the same
 * page GraphQL endpoint on the page's own host: no credentials, and a text/plain body so the opaque origin sends no
 * preflight. Writes never leave the page; the host refuses them too.
 *
 * The capture's address carries the exporter's key (`?key=`, lib/export read-key), which names the requester the
 * export was asked for; it rides in the BODY (never a header, which would preflight, nor a new URL), and the endpoint
 * reads as that requester (lib/graphql-compat). Without one the read is a signed-out viewer's.
 */
export function createDomainReadTransport(page:{pageId:string;revision:string},location:Pick<Location,'href'>,send:typeof fetch):RemotePort{
 const key=new URL(location.href).searchParams.get('key');
 return {online:()=>true,async execute(request){
  if(request.operation!=='query')return {data:null,errors:[{message:DOMAIN_READ_ONLY_MESSAGE}]};
  let response:Response;
  try{response=await send(new URL(`/api/artifacts/${encodeURIComponent(page.pageId)}/graphql`,location.href),{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({...request,revision:page.revision,...(key?{key}:{})})});}
  catch{throw new RemoteUnreachable('This page could not reach its data');}
  const reply=await response.json().catch(()=>null) as (Awaited<ReturnType<RemotePort['execute']>>&{error?:unknown})|null;
  if(reply&&(Object.hasOwn(reply,'data')||Array.isArray(reply.errors)))return reply;
  return {data:null,errors:[{message:typeof reply?.error==='string'?reply.error:`Data request failed (${response.status})`}]};
 }};
}
/**
 * `sql` (browser-client) from the same unframed page, for the exporter's capture alone: straight to the page SQL door
 * on its own host, credentials omitted, text/plain (no preflight), read-only, the capture's key in the body. The door
 * admits an opaque origin only as the requester that key names (lib/page-doors `opaqueSqlRead`). An owner host's page
 * carries no key (server/user-host strips it), so its `sql` never leaves the page: RemoteUnreachable, as before.
 * Kept out of the read transport above: the reader carries no SQL code (its gzip budget, html-runtime build.test).
 */
export function createDomainSql(page:{pageId:string;revision:string},location:Pick<Location,'href'>,send:typeof fetch){
 const key=new URL(location.href).searchParams.get('key');
 return async(request:{sql:string;params:Record<string,string|number|boolean|null>}):Promise<unknown>=>{
  if(!key)throw new RemoteUnreachable('sql runs in a page the app frames');
  let response:Response;
  try{response=await send(new URL(`/api/artifacts/${encodeURIComponent(page.pageId)}/sql`,location.href),{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({sql:request.sql,params:request.params,revision:page.revision,readOnly:true,key})});}
  catch{throw new RemoteUnreachable('This page could not reach its data');}
  return response.json().catch(()=>({error:'unexpected',message:`Data request failed (${response.status})`}));
 };
}
/**
 * A page function call (./fn-fetch) from the same unframed page: straight to the page's function path on its own
 * host, credentials omitted, a POST body as text/plain (no preflight). The host reads as nobody and runs reads only
 * (lib/page-doors `pageFunction`); an export capture's key is not carried, so a private page answers 404.
 */
export function createDomainFunctionCall(page:{pageId:string;revision:string},location:Pick<Location,'href'>,send:typeof fetch):FunctionCaller{
 return async(request,signal)=>{
  const url=new URL(`/api/artifacts/${encodeURIComponent(page.pageId)}/fn/${request.name}${request.search}`,location.href);
  // The served revision, as a query parameter (no preflight): an archived copy never runs newer backend code.
  url.searchParams.set('revision',page.revision);
  const response=await send(url,{method:request.method,credentials:'omit',redirect:'error',cache:'no-store',...(signal?{signal}:{}),...(request.method==='POST'?{headers:{'content-type':'text/plain;charset=UTF-8'},body:request.body??''}:{})});
  const headers:Record<string,string>={};const type=response.headers.get('content-type');if(type)headers['content-type']=type;
  return {status:response.status,headers,body:await response.text()};
 };
}
