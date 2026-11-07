import {DOMAIN_READ_ONLY_MESSAGE} from '@artifactbin/contracts/domain-footer';
import {RemoteUnreachable,type RemotePort} from './apollo/apollo-contracts';
/**
 * A page served on a anonymous owner host (server/user-host), or as the exporter's capture (document-serving/raw), is a
 * top-level sandboxed page with no app frame, so the frame relay never attaches. Its reads go straight to the same
 * page GraphQL endpoint on the page's own host: no credentials, and a text/plain body so the opaque origin sends no
 * preflight. Writes never leave the page; the host refuses them too.
 *
 * The capture's address carries the exporter's key (`?key=`, lib/export read-key), which names the requester the
 * export was asked for; it rides in the BODY (never a header, which would preflight, nor a new URL), and the endpoint
 * reads as that requester (lib/page-graphql). Without one the read is a signed-out viewer's.
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
