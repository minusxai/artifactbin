import {RemoteUnreachable} from './apollo/apollo-contracts';
/**
 * Unframed SQL goes to this page's own-host door, credential-free and read-only. A verified publishing
 * host decides anonymous readership itself. On the canonical host only an export capture's key admits an
 * opaque request; its existing key contract is unchanged. Loaded lazily; the reader carries no SQL code.
 */
export function createDomainSql(page:{pageId:string;revision:string},location:Pick<Location,'href'>,send:typeof fetch){
 const key=new URL(location.href).searchParams.get('key');
 return async(request:{sql?:string;query?:string;params:Record<string,string|number|boolean|null>}):Promise<unknown>=>{
  let response:Response;
  try{response=await send(new URL(`/api/artifacts/${encodeURIComponent(page.pageId)}/sql`,location.href),{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({...(request.query!==undefined?{query:request.query}:{sql:request.sql}),params:request.params,revision:page.revision,readOnly:true,...(key?{key}:{})})});}
  catch{throw new RemoteUnreachable('This page could not reach its data');}
  return response.json().catch(()=>({error:'unexpected',message:`Data request failed (${response.status})`}));
 };
}
