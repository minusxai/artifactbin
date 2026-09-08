import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { actorOf, inProcess } from '@artifactbin/utils';
import { createProxy, type ProxyOptions } from '../src/parts';
import { mintTestToken, testDb, testProxyOptions } from './helpers';

const main = 'https://example.test', controls = 'https://i.example.test';
let options: ProxyOptions, bearer: string;
beforeAll(async () => {
  const upstream = new Hono();
  upstream.all('*', c => c.json(actorOf(c.req.raw)));
  options = await testProxyOptions({ upstream: inProcess(upstream),
    sessions: { resolve: async () => ({ userId: 'full' }) } });
  options.env = { ...options.env, APP__PUBLIC_BASE_URL: main, APP__CONTROLS_ORIGIN: controls };
  bearer = await mintTestToken({ id: 'boundary-token', userId: 'agent', pg: testDb().pg() });
});
const call = (host: string, path: string, method = 'GET', headers: Record<string, string> = {}) =>
  createProxy(options).request(`${host}${path}`, { method, headers });
const trusted = { origin: main, 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-origin' };
describe('the composed main-only browser boundary',()=>{
 it('never serves retired or unknown hosts, even with a valid bearer',async()=>{
  for(const host of [controls,'https://evil.example.test'])for(const path of ['/','/login','/api/my/artifacts','/a/abc123','/controls/consent']){
   expect((await call(host,path,'GET',{authorization:'Bearer '+bearer})).status).toBe(421);
   expect((await call(host,path,'POST',trusted)).status).toBe(421);
  }
 });
 it('uses full validated identity for main document navigation without read-handle promotion',async()=>{
  expect(await(await call(main,'/a/abc123')).json()).toEqual({credential:'session',userId:'full'});
  const proxy=createProxy({...options,sessions:{resolve:async()=>null}});
  expect(await(await proxy.request(main+'/a/abc123',{headers:{cookie:'__Secure-mx-read=old'}})).json()).toEqual({credential:'none'});
 });
 it('requires exact origin and CSRF for account and document writes',async()=>{
  for(const path of ['/api/my/artifacts','/a/abc123/mutate']){
   expect((await call(main,path,'POST',trusted)).status).toBe(200);
   const attacks:Record<string,string>[]=[{},{origin:main},{...trusted,origin:controls},{...trusted,origin:'null'}];
   for(const headers of attacks)expect((await call(main,path,'POST',headers)).status).toBe(403);
  }
 });
 it('keeps independent bearer and operator credentials with no cookie fallback',async()=>{
  expect(await(await call(main,'/api/artifacts','POST',{authorization:'Bearer '+bearer})).json()).toMatchObject({credential:'bearer',userId:'agent'});
  const proxy=createProxy({...options,upstream:async(request,actor)=>Response.json({authorization:request.headers.get('authorization'),actor})});
  for(const authorization of ['Bearer invalid','bearer invalid','Bearer'])expect(await(await proxy.request(main+'/api/artifacts',{headers:{authorization}})).json()).toEqual({authorization,actor:{credential:'none'}});
 });
 it('admits private reads only with browser-controlled same-origin proof',async()=>{
  for(const path of ['/api/page/session','/api/my/artifacts','/a/abc123/events']){
   expect((await call(main,path,'GET',{'sec-fetch-site':'same-origin'})).status).toBe(200);
   expect((await call(main,path)).status).toBe(403);
   expect((await call(main,path,'GET',{'sec-fetch-site':'same-site',origin:controls})).status).toBe(403);
  }
 });
 it('does not inject retired frame/CORS policy on main responses',async()=>{
  const response=await call(main,'/account');
  expect(response.headers.get('content-security-policy')).toBeNull();
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
 });
});
