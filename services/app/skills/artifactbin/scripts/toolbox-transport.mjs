/** Internal: origin validation and JSON transport, with shared command refusal errors.
 * Used by: toolbox-client.mjs; callers retain credential, retry and response policy. */
export class ToolError extends Error{constructor(code,message,exit=1,recovery=
  'Inspect the refusal and correct the request.',details){super(message);Object.assign(this,{code,
  exit,recovery,details});}}
export function serverOrigin(value){let url;try{url=new URL(value);}catch{throw new ToolError(
  'server_required','Select --server ORIGIN or origin-bound ARTIFACTBIN_URL.',2);}
if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||
   url.search||url.hash)throw new ToolError('invalid_origin',
   'Select an HTTP(S) origin without path or credentials.',2);return url.origin;}
// Callers own credential selection, retry and refusal policy.
export function requestUrl(server,route){
 const url=new URL(route,server);
 if(url.origin!==server||!route.startsWith('/')||route.startsWith('//')||route.includes('\\'))
  throw new ToolError('origin_mismatch','Refused a request outside the selected origin.',2);
 return url;
}
export function originRequest(server,route,{method='GET',body,headers={},signal},fetcher=fetch){
 const url=requestUrl(serverOrigin(server),route);
 return fetcher(url.href,{method,redirect:'error',...(signal?{signal}:{}),
  headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
}
