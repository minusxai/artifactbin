import {describe,it,expect} from 'vitest';
import {localOwner,type LocalOwnerOptions} from '../local-owner';

const origin='http://127.0.0.1:7341';
function fixture(extra:Partial<LocalOwnerOptions>={}){
 let now=1000;
 const host=localOwner({origin,instanceId:'instance-one',ownerId:'usr_owner',cookieSecret:'s'.repeat(64),
  now:()=>now,resolveBearer:async token=>token==='owner-token'?{credential:'bearer',userId:'usr_owner',tokenId:'tok_owner',email:'untrusted@example.com',emailVerified:true}:null,
  upstream:async(_request,actor)=>Response.json(actor),...extra});
 return {host,advance:(ms:number)=>{now+=ms;}};
}
const call=(path:string,init?:RequestInit)=>new Request(origin+path,init);
async function ticket(host:ReturnType<typeof fixture>['host'],destination='/a/abc123'){
 const response=await host.fetch(call('/_afbin/browser-ticket',{method:'POST',headers:{authorization:'Bearer owner-token','content-type':'application/json'},body:JSON.stringify({destination})}));
 expect(response.status).toBe(200);
 return (await response.json()) as {ticket:string};
}

describe('local owner authentication',()=>{
 it('never treats loopback or an email as authentication; rejects non-loopback composition',async()=>{
  expect(()=>fixture({origin:'https://public.example'})).toThrow(/loopback/);
  const {host}=fixture();
  expect(await (await host.fetch(call('/api/artifacts'))).json()).toEqual({credential:'none'});
  const signed=await host.fetch(call('/api/artifacts',{headers:{authorization:'Bearer owner-token'}}));
  expect(await signed.json()).toEqual({credential:'bearer',userId:'usr_owner',tokenId:'tok_owner'});
  expect((await host.fetch(new Request('http://localhost:7341/api/artifacts'))).status).toBe(421);
 });
 it('exchanges a one-use ticket for a cookie without a secret in the redirect URL',async()=>{
  const {host}=fixture();const issued=await ticket(host);
  const request=()=>call('/_afbin/browser-login',{method:'POST',headers:{origin:'null','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(issued)});
  const response=await host.fetch(request());
  expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('/a/abc123');
  const cookie=response.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');
  const session=await host.fetch(call('/api/artifacts',{headers:{cookie:cookie.split(';')[0]!}}));
  expect(await session.json()).toEqual({credential:'session',userId:'usr_owner'});
  expect((await host.fetch(request())).status).toBe(401);
 });
 it('rejects missing credentials, hostile destinations and expired tickets',async()=>{
  const {host,advance}=fixture();
  expect((await host.fetch(call('/_afbin/browser-ticket',{method:'POST'}))).status).toBe(401);
  for(const destination of ['//evil.example','https://evil.example','/\\evil.example','/a/abc123#secret']){
   expect((await host.fetch(call('/_afbin/browser-ticket',{method:'POST',headers:{authorization:'Bearer owner-token'},body:JSON.stringify({destination})}))).status).toBe(400);
  }
  const issued=await ticket(host);advance(61000);
  expect((await host.fetch(call('/_afbin/browser-login',{method:'POST',body:new URLSearchParams(issued)}))).status).toBe(401);
 });
 it('does not fall back to a cookie after an invalid bearer, or accept a cookie for another instance',async()=>{
  const {host}=fixture();const issued=await ticket(host);
  const response=await host.fetch(call('/_afbin/browser-login',{method:'POST',body:new URLSearchParams(issued)}));
  const cookie=response.headers.get('set-cookie')!.split(';')[0]!;
  expect(await (await host.fetch(call('/api/artifacts',{headers:{cookie,authorization:'Bearer invalid'}}))).json()).toEqual({credential:'none'});
  const other=fixture({instanceId:'instance-two'}).host;
  expect(await (await other.fetch(call('/api/artifacts',{headers:{cookie}}))).json()).toEqual({credential:'none'});
 });
});
