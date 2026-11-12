import {RemoteUnreachable} from './apollo/apollo-contracts';
/**
 * `sql` (browser-client) from the same unframed page, for the exporter's capture alone: straight to the page SQL door
 * on its own host, credentials omitted, text/plain (no preflight), read-only, the capture's key in the body. The door
 * admits an opaque origin only as the requester that key names (lib/page-doors `opaqueSqlRead`). An owner host's page
 * carries no key (server/user-host strips it), so its `sql` never leaves the page: RemoteUnreachable, as before.
 * Kept out of the read transport above: the reader carries no SQL code (its gzip budget, html-runtime build.test).
 */
export function createDomainSql(page:{pageId:string;revision:string},location:Pick<Location,'href'>,send:typeof fetch){
 const key=new URL(location.href).searchParams.get('key');
 return async(request:{sql?:string;query?:string;params:Record<string,string|number|boolean|null>}):Promise<unknown>=>{
  if(!key)throw new RemoteUnreachable('sql runs in a page the app frames');
  let response:Response;
  try{response=await send(new URL(`/api/artifacts/${encodeURIComponent(page.pageId)}/sql`,location.href),{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({...(request.query!==undefined?{query:request.query}:{sql:request.sql}),params:request.params,revision:page.revision,readOnly:true,key})});}
  catch{throw new RemoteUnreachable('This page could not reach its data');}
  return response.json().catch(()=>({error:'unexpected',message:`Data request failed (${response.status})`}));
 };
}
