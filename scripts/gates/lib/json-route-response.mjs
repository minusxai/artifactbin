import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';

/**
 * These same-origin JSON mutations must run once. Playwright's route.fetch uses a
 * shared keep-alive pool, whose idle socket can reset after the login/setup gap.
 * Use a new connection instead of retrying a POST whose outcome is unknown.
 */
async function fetchMutation(request){
 const url=new URL(request.url());
 const send=url.protocol==='https:'?httpsRequest:httpRequest;
 const headers={...await request.allHeaders(),'accept-encoding':'identity',connection:'close'};
 return new Promise((resolve,reject)=>{
  const outgoing=send(url,{method:request.method(),headers,agent:false,timeout:30000},async incoming=>{
   try{
    const chunks=[];for await(const chunk of incoming)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const headers=Object.fromEntries(Object.entries(incoming.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,Array.isArray(value)?value.join('\n'):value]));
    const status=incoming.statusCode;
    resolve({status,headers,body});
   }catch(error){reject(error);}
  });
  outgoing.on('error',reject);
  outgoing.on('timeout',()=>outgoing.destroy(new Error('JSON mutation response timed out')));
  outgoing.end(request.postDataBuffer());
 });
}

/** Deliver one real response before the UI navigates; return its outcome to the awaiting gate. */
export async function jsonRouteResponse(route){
 try{
  const received=await fetchMutation(route.request());
  const body=JSON.parse(received.body.toString('utf8'));
  // Socket framing belongs to the upstream connection, not Chromium's fulfilled response.
  const headers={...received.headers};delete headers.connection;delete headers['transfer-encoding'];
  await route.fulfill({...received,headers});
  const response={status:()=>received.status,headers:()=>received.headers};
  return {response,body};
 }catch(error){
  await route.abort('failed').catch(()=>{});
  return {error};
 }
}

/** Validate creation before a gate waits for controls on the new document. No replay. */
export function createdDocumentResponse(result) {
  if (result.error) throw result.error;
  if (result.response.status() !== 201) throw new Error(`Document creation returned HTTP ${result.response.status()}`);
  if (typeof result.body?.id !== 'string' || !/^[A-Za-z0-9]+$/.test(result.body.id)) {
    throw new Error('Document creation returned no valid artifact ID');
  }
  return result;
}
