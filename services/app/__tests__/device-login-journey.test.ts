import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET} from '@/lib/platform';
import {useAppHarness} from './harness';
import {expect,it} from 'vitest';
useAppHarness();

it('a signed-out HTTP author logs in with email OTP and receives a refreshable account bearer',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'http-login-')),origin='http://localhost:3000';
 const application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')});
 const fetch=(path:string,init:RequestInit={})=>application.fetch(new Request(origin+path,init));
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 try {
  expect((await post('/oauth/device',{})).status).toBe(404);
  const email='mxmx_test_http_login@example.test';
  expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
  const sent=(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email);
  const login=await post('/api/auth/sign-in/email-otp',{email,otp:sent.at(-1).otp});expect(login.status).toBe(200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const minted=await post('/api/authentication/token',{}, {cookie});expect(minted.status).toBe(201);
  const grant=await minted.json();expect(grant).toMatchObject({access_token:expect.stringMatching(/^mx_/),refresh_token:expect.stringMatching(/^mxr_/),client_id:expect.any(String)});
  const renewed=await post('/oauth/token',{grant_type:'refresh_token',refresh_token:grant.refresh_token,client_id:grant.client_id,resource:origin+'/api'});
  expect(renewed.status).toBe(200);expect((await renewed.json()).refresh_token).not.toBe(grant.refresh_token);
 } finally {await rm(directory,{recursive:true,force:true});}
});
