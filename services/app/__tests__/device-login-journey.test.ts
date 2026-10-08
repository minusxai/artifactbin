import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTeamApplication} from '../server/team-application';
import {AUTH_SECRET} from '@/lib/platform';
import {useAppHarness} from './harness';
import {expect,it} from 'vitest';
useAppHarness();

it('a signed-out visitor logs in with a typed code, returns to the approval page, approves, and the agent receives a token',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'device-login-')),origin='http://localhost:3000';
 const application=await createTeamApplication({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')},process.cwd());
 const fetch=(path:string,init:RequestInit={})=>application.fetch(new Request(origin+path,init));
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const codes=async(email:string)=>(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(message=>message.to===email).map(message=>message.otp as string);
 try{
  const pairing=await(await post('/oauth/device',{})).json();
  const callback=new URL(pairing.verification_uri_complete).pathname+new URL(pairing.verification_uri_complete).search;
  const signedOut=await fetch(callback);
  expect(signedOut.status).toBe(200);
  const page=await signedOut.text();
  expect(page).toContain('Log in to connect');
  expect(page).toContain(`value="${callback.replace(/&/g,'&amp;')}"`);

  const email='mxmx_test_device_login@example.test';
  expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
  // A resend inside the code's lifetime must keep the code already in the user's mail app valid.
  expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
  const sent=await codes(email);expect(new Set(sent).size).toBe(1);
  const login=await post('/api/auth/sign-in/email-otp',{email,otp:sent[0]});expect(login.status).toBe(200);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');

  const consent=await fetch(callback,{headers:{cookie}});
  expect(consent.status).toBe(200);
  expect(await consent.text()).toContain('Approve connection');
  expect((await post('/oauth/device/token',{device_code:pairing.device_code})).status).toBe(400);
  const approved=await fetch('/oauth/device/approve',{method:'POST',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({user_code:pairing.user_code})});
  expect(approved.status).toBe(200);
  const token=await post('/oauth/device/token',{device_code:pairing.device_code});
  expect(token.status).toBe(200);
  expect(await token.json()).toMatchObject({access_token:expect.stringMatching(/^mx_/),refresh_token:expect.stringMatching(/^mxr_/)});
  const again=await fetch(callback,{headers:{cookie}});
  expect(again.status).toBe(400);expect(await again.text()).toContain('Already approved');
 }finally{await rm(directory,{recursive:true,force:true});}
});
