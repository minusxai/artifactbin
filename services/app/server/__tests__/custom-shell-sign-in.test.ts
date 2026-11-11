/**
 * SIGN-IN THROUGH A CUSTOM SHELL (../custom-shell, contracts url-space `/login` `shell`), through the real login
 * service composed as server.ts composes it: a browser without a session gets the operator's file at `/login` (its
 * query kept, its nonce and the app page's policy); the file's JSON calls sign the person in (test-domain code) to a
 * session cookie; `/login` then sends that browser to its callbackUrl, same-origin only; the code's attempt cap holds;
 * sign-out ends the session and `/login` is the file again. Better Auth's Origin rule (a sign-in POST naming another
 * Origin, and a cookie-bearing POST from one, 403) is off under NODE_ENV=test, read once at its import, so the
 * deployment harness that runs the server in development checks it in a browser instead.
 */
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createAuthComposedHost} from '@/test/helpers/auth-host';
import {AUTH_SECRET} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {useAppHarness} from '@/__tests__/harness';
useAppHarness();

const ORIGIN='http://localhost:3000',DOMAIN='shell-sign-in.test',CODE='c'.repeat(40);
const SHELL='<!doctype html><html><head><script nonce="__CSP_NONCE__">window.signIn=1</script></head><body data-shell></body></html>';
let dir='',application:Awaited<ReturnType<typeof createAuthComposedHost>>;
// One composed host for the file: closing it closes the harness database.
beforeAll(async()=>{
 dir=await mkdtemp(join(tmpdir(),'shell-sign-in-'));const file=join(dir,'shell.html');await writeFile(file,SHELL);
 overrideConfig({},{APP__DEPLOYMENT_MODE:'public',APP__SHELL_FILE:file});
 application=await createAuthComposedHost({APP__PUBLIC_BASE_URL:ORIGIN,AUTH__SECRET:AUTH_SECRET,TEST_DOMAIN:DOMAIN,TEST_DOMAIN_OTP:CODE,
  EMAIL__DEV_OUTBOX_PATH:join(dir,'outbox.jsonl')});
});
afterAll(async()=>{await application?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});});
const get=(path:string,cookie='')=>application.fetch(new Request(ORIGIN+path,{headers:{accept:'text/html',...(cookie?{cookie}:{})}}));
const post=(path:string,body:unknown,headers:Record<string,string>={})=>application.fetch(new Request(ORIGIN+path,{method:'POST',
 headers:{origin:ORIGIN,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
const cookieOf=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');

it('serves the shell at /login, signs in through the JSON API to a session cookie, then sends the browser on, same-origin only',async()=>{
 const login=await get('/login?callbackUrl=%2Fa%2FAb3xK9Lm%3Fgroup%3Dg1');
 expect(login.status).toBe(200);
 const body=await login.text(),nonce=/script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/.exec(login.headers.get('content-security-policy')!)?.[1];
 expect(nonce).toBeTruthy();
 expect(body).toBe(SHELL.replace('__CSP_NONCE__',nonce!));
 expect(login.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
 expect(login.headers.get('cache-control')).toBe('no-store');

 const email=`person@${DOMAIN}`;
 const malformed=await post('/api/auth/email-otp/send-verification-otp',{email:'not-an-address',type:'sign-in'});
 expect(malformed.status).toBe(400);expect(await malformed.json()).toMatchObject({code:'INVALID_EMAIL'});
 const sent=await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'});
 expect(sent.status).toBe(200);
 expect(sent.headers.get('x-artifactbin-code-delivery')).toBe('operator_outbox');
 const wrong=await post('/api/auth/sign-in/email-otp',{email,otp:'000000'});
 expect(wrong.status).toBe(400);
 expect(await wrong.json()).toMatchObject({code:'INVALID_OTP'});
 expect(wrong.headers.getSetCookie()).toEqual([]);

 const signed=await post('/api/auth/sign-in/email-otp',{email,otp:CODE});
 expect(signed.status).toBe(200);
 expect(await signed.json()).toMatchObject({user:{email},account_created_this_login:true});
 const session=signed.headers.getSetCookie().find(value=>value.startsWith('better-auth.session_token='));
 expect(session).toMatch(/HttpOnly/i);expect(session).toMatch(/SameSite=Lax/i);
 const cookie=cookieOf(signed);

 // Signed in, /login is never the file: it sends the browser to its callbackUrl, and only to this origin.
 for(const [callback,target] of [['%2Fa%2FAb3xK9Lm%3Fgroup%3Dg1','/a/Ab3xK9Lm?group=g1'],['%2Fstories%2Fs1','/stories/s1'],['%2F%2Fevil.example','/'],
  ['https%3A%2F%2Fevil.example%2Fx','/'],['%2F%5Cevil.example','/'],['javascript%3Aalert(1)','/'],['%2Flogin%3FcallbackUrl%3D%2Fx','/'],['','/']] as const){
  const bounced=await get(`/login${callback?`?callbackUrl=${callback}`:''}`,cookie);
  expect(bounced.status,callback).toBe(302);expect(bounced.headers.get('location'),callback).toBe(target);
 }
 expect((await get('/',cookie)).status).toBe(200);

 const out=await post('/api/auth/sign-out',{},{cookie});
 expect(out.status).toBe(200);
 expect(out.headers.getSetCookie().some(value=>/^better-auth\.session_token=;/.test(value))).toBe(true);
 const after=await get('/login?signedOut=1',cookie);
 expect(after.status).toBe(200);expect(await after.text()).toContain('data-shell');
});

it('keeps the code\'s attempt cap: five wrong codes spend it',async()=>{
 const email=`capped@${DOMAIN}`;
 expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 for(let i=0;i<5;i++)expect((await post('/api/auth/sign-in/email-otp',{email,otp:`00000${i}`})).status).toBe(400);
 // Five wrong codes spend it: the right one is refused until a new code is requested.
 const spent=await post('/api/auth/sign-in/email-otp',{email,otp:CODE});
 expect(spent.status).toBe(403);expect(await spent.json()).toMatchObject({code:'TOO_MANY_ATTEMPTS'});
 expect(spent.headers.getSetCookie()).toEqual([]);
 expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 expect((await post('/api/auth/sign-in/email-otp',{email,otp:CODE})).status).toBe(200);
});

it('refuses a sign-in another site starts, so it cannot plant a session; no Origin (a script) and this origin pass',async()=>{
 const email=`crosssite@${DOMAIN}`;
 expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 const foreign=await post('/api/auth/sign-in/email-otp',{email,otp:CODE},{origin:'https://evil.example'});
 expect(foreign.status).toBe(403);expect(foreign.headers.getSetCookie()).toEqual([]);
 expect((await post('/api/auth/sign-in/email-otp',{email,otp:CODE},{'sec-fetch-site':'cross-site'})).status).toBe(403);
 expect((await post('/api/auth/sign-in/email-otp',{email,otp:CODE},{origin:ORIGIN})).status).toBe(200);
});
