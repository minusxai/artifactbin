import {createServer} from 'node:http';
import {once} from 'node:events';
import {expect,it} from 'vitest';
import {connectAgent,connectionBrowserCookie} from '../gates/lib/account-connection.mjs';

it('gets a bearer from the verified email session and retains its separate browser cookie',async()=>{
 const requests=[];
 const server=createServer((request,response)=>{
  requests.push({path:request.url,method:request.method,cookie:request.headers.cookie,origin:request.headers.origin});
  response.setHeader('content-type','application/json');
  if(request.url==='/api/authentication/token'&&request.method==='POST'&&request.headers.cookie==='session=fixture'){
   response.statusCode=201;response.end(JSON.stringify({access_token:'test-grant',refresh_token:'test-refresh',client_id:'test-client',expires_in:3600}));
  }else{response.statusCode=404;response.end(JSON.stringify({error:'not_found'}));}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  expect(await connectAgent(base,{cookie:'session=fixture'})).toEqual({token:'test-grant'});
  expect(connectionBrowserCookie(base,'test-grant')).toBe('session=fixture');
  expect(requests).toEqual([{path:'/api/authentication/token',method:'POST',cookie:'session=fixture',origin:base}]);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
