import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {jsonRouteResponse,createdDocumentResponse} from '../gates/lib/json-route-response.mjs';
/** Runs `fn(origin)` against a real server with `handler`, then drops its connections and closes it. */
const withServer=async(handler,fn)=>{
 const server=createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return await fn(`http://127.0.0.1:${server.address().port}`);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
};
/** A browser-route request for a POST to `url`. */
const postRequest=(url,{headers={'content-type':'application/json'},body='{}'}={})=>()=>({url:()=>url,method:()=> 'POST',allHeaders:async()=>headers,postDataBuffer:()=>Buffer.from(body)});
it('sends each mutation on a fresh socket, retaining the authenticated request and response',async()=>{
 const requests=[],sockets=new Set();
 await withServer(async(req,res)=>{
  sockets.add(req.socket);
  let body='';for await(const chunk of req)body+=chunk;
  requests.push({method:req.method,body,cookie:req.headers.cookie,origin:req.headers.origin});
  res.writeHead(201,{'content-type':'application/json','set-cookie':['session=one; HttpOnly','pages=two; HttpOnly'],'x-real-handler':'yes'});
  res.end(JSON.stringify({id:`copy${requests.length}`}));
 },async origin=>{
  const deliveries=[];
  for(let i=0;i<2;i++){
   let delivered=false;
   const result=await jsonRouteResponse({
    request:postRequest(`${origin}/fork`,{headers:{'content-type':'application/json',cookie:'session=owner',origin},body:'{"title":"copy"}'}),
    fetch:async()=>{throw Error('shared keep-alive transport must not be used');},
    fulfill:async response=>{deliveries.push(response);await Promise.resolve();delivered=true;},
    abort:async()=>{throw Error('must not abort success');},
   });
   expect(result.error).toBeUndefined();expect(delivered).toBe(true);
   expect(result.body).toEqual({id:`copy${i+1}`});expect(result.response.status()).toBe(201);
   expect(result.response.headers()['set-cookie']).toBe('session=one; HttpOnly\npages=two; HttpOnly');
  }
  expect(sockets.size).toBe(2);
  expect(requests).toEqual(Array(2).fill({method:'POST',body:'{"title":"copy"}',cookie:'session=owner',origin}));
  expect(deliveries.map(value=>({status:value.status,body:value.body.toString(),header:value.headers['x-real-handler'],cookies:value.headers['set-cookie']}))).toEqual([1,2].map(i=>({status:201,body:`{"id":"copy${i}"}`,header:'yes',cookies:'session=one; HttpOnly\npages=two; HttpOnly'})));
 });
});
it('surfaces a reset after the handler mutates and aborts the browser request without replaying the POST',async()=>{
 let mutations=0,aborts=0,deliveries=0;
 await withServer(async(req)=>{
  for await(const _chunk of req){};
  mutations++;req.socket.destroy();
 },async origin=>{
  const outcome=await jsonRouteResponse({
   request:postRequest(`${origin}/fork`),
   fulfill:async()=>{deliveries++;},abort:async()=>{aborts++;},
  });
  expect(outcome.error.code).toBe('ECONNRESET');expect(mutations).toBe(1);expect(aborts).toBe(1);expect(deliveries).toBe(0);
 });
});

it.each([
 {name:'an HTTP refusal',status:403,payload:'{"error":"forbidden"}',deliveryError:false},
 {name:'invalid JSON',status:200,payload:'not JSON',deliveryError:false},
 {name:'a delivery failure',status:201,payload:'{"id":"copy1"}',deliveryError:true},
])('preserves $name without resubmitting the mutation',async({status,payload,deliveryError})=>{
 let mutations=0,aborts=0,deliveries=0;
 await withServer(async(req,res)=>{
  for await(const _chunk of req){};
  mutations++;res.writeHead(status,{'content-type':'application/json'});res.end(payload);
 },async origin=>{
  const deliveryFailure=Error('browser closed during delivery');
  const outcome=await jsonRouteResponse({
   request:postRequest(`${origin}/fork`),
   fulfill:async response=>{deliveries++;expect(response.status).toBe(status);expect(response.body.toString()).toBe(payload);if(deliveryError)throw deliveryFailure;},
   abort:async()=>{aborts++;},
  });
  expect(mutations).toBe(1);
  if(deliveryError){expect(outcome.error).toBe(deliveryFailure);expect(aborts).toBe(1);expect(deliveries).toBe(1);}
  else if(status===403){expect(outcome.response.status()).toBe(403);expect(outcome.body).toEqual({error:'forbidden'});expect(aborts).toBe(0);expect(deliveries).toBe(1);}
  else{expect(outcome.error).toBeInstanceOf(SyntaxError);expect(aborts).toBe(1);expect(deliveries).toBe(0);}
 });
});


it('reports failed creation before waiting for document controls without replaying it',async()=>{
 let requests=0;
 await withServer(async(req,res)=>{
  for await(const _chunk of req){};
  requests++;res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'unavailable'}));
 },async origin=>{
  const captured=await jsonRouteResponse({
   request:postRequest(`${origin}/api/start`),
   fulfill:async()=>{},abort:async()=>{},
  });
  expect(()=>createdDocumentResponse(captured)).toThrow('Document creation returned HTTP 503');
  expect(requests).toBe(1);
 });
});

it('requires a real artifact identity and preserves the original transport error',()=>{
 const response={status:()=>201};
 expect(createdDocumentResponse({response,body:{id:'abc123'}}).body.id).toBe('abc123');
 for(const id of [undefined,'',1,'../other'])expect(()=>createdDocumentResponse({response,body:{id}})).toThrow('Document creation returned no valid artifact ID');
 const error=Error('creation transport reset');
 expect(()=>createdDocumentResponse({error})).toThrow(error);
});
