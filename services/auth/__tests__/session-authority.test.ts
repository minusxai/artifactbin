import {describe,it,expect} from 'vitest';
import {HUMAN_SESSION_LIVE_PATH,SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {humanSessionClient} from '@artifactbin/utils';
import {createAuthHost} from '../src/parts';

describe('split human session authority',()=>{
 const secret='test-service-secret';
 const host=(live=async(s:string,u:string)=>s==='session'&&u==='user')=>createAuthHost({env:{INTERNAL__SERVICE_SECRET:secret},cookieSecret:'test',tokens:{byToken:async()=>null,byId:async()=>null,invalidate:()=>{}},sessions:{resolve:async()=>null,live},upstream:async()=>new Response('app')});
 it('admits only authenticated bounded POSTs and follows owner liveness',async()=>{
  let active=true;const app=host(async(s,u)=>active&&s==='session'&&u==='user');
  const call=(body:unknown,key=secret)=>app.request(HUMAN_SESSION_LIVE_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:key,'content-type':'application/json'},body:JSON.stringify(body)});
  expect((await call({sessionId:'session',userId:'user'},'wrong')).status).toBe(401);
  expect((await call({sessionId:'session',userId:'user'})).headers.get('cache-control')).toBe('no-store');
  expect(await(await call({sessionId:'session',userId:'user'})).json()).toEqual({live:true});
  expect(await(await call({sessionId:'session',userId:'other'})).json()).toEqual({live:false});
  active=false;expect(await(await call({sessionId:'session',userId:'user'})).json()).toEqual({live:false});
  expect((await call({sessionId:'x'.repeat(9000),userId:'user'})).status).toBe(413);
  expect((await call(null)).status).toBe(400);
  expect((await app.request(HUMAN_SESSION_LIVE_PATH)).status).toBe(405);
 });
 it('client sends identifiers in body, fails closed on unavailable or malformed authority',async()=>{
  const app=host();let seen:Request|undefined;
  const client=humanSessionClient('http://authority',{serviceSecret:secret,fetch:async request=>{seen=request;return app.fetch(request);}});
  expect(await client.live('session','user')).toBe(true);expect(seen!.url).toBe(`http://authority${HUMAN_SESSION_LIVE_PATH}`);
  expect(seen!.headers.get(SERVICE_AUTH_HEADER)).toBe(secret);
  for(const response of [Response.json({live:'true'}),new Response('',{status:503})]){
   expect(await humanSessionClient('http://authority',{serviceSecret:secret,fetch:async()=>response}).live('session','user')).toBe(false);
  }
  expect(await humanSessionClient('http://authority',{serviceSecret:secret,fetch:async()=>{throw Error('down');}}).live('session','user')).toBe(false);
  expect(()=>humanSessionClient('http://authority',{serviceSecret:''})).toThrow();
 });
});
