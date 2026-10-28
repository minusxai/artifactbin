import {beforeEach,describe,expect,it} from 'vitest';
import {overrideConfig} from '@/lib/platform/config';
import {AGENT_COOKIE} from '@/lib/accounts/agent-session';
import {createAppServer} from '../app';
import {request,useAppHarness} from '@/__tests__/harness';
useAppHarness();
beforeEach(()=>overrideConfig({}, {APP__DEPLOYMENT_MODE:'public'}));
const app=createAppServer({indexHtml:async()=>'<html><head></head><body><div id="root"></div></body></html>'});
describe('application home',()=>{
 it.each(['GET','HEAD'])('serves /start anonymously on %s without creating an artifact',async method=>{
  const response=await app.request('/start',{method});
  expect(response.status).toBe(200);
  expect(response.headers.get('location')).toBeNull();
 });
 it.each(['GET','HEAD'])('redirects an unauthenticated %s to login without caching',async method=>{
  const response=await app.request('/',{method});
  expect(response.status).toBe(302);expect(response.headers.get('location')).toBe('/login');
  expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it.each(['GET','HEAD'])('serves the company setup homepage anonymously on %s',async method=>{
  overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:'owner@example.test'});
  const response=await app.request('/',{method,headers:{cookie:`${AGENT_COOKIE}=stale`}});
  expect(response.status).toBe(200);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it('renders the shared workspace shell for an authenticated account',async()=>{
  const response=await app.request(request('/',{actor:{credential:'session',userId:'home-user',email:'private@example.test'}}));
  expect(response.status).toBe(200);expect(await response.text()).toContain('id="root"');
 });
 it('flags the login redirect for a browser still holding its old guest cookie',async()=>{
  const response=await app.request('/',{headers:{cookie:`${AGENT_COOKIE}=stale`}});
  expect(response.status).toBe(302);expect(response.headers.get('location')).toBe('/login?signedOut=1');
 });
 it('sends anonymous held-token sessions to login without exposing drafts',async()=>{
  const response=await app.request(request('/',{actor:{credential:'agent-cookie',tokenId:'held-token',heldTokenIds:['held-token']}}));
  expect(response.status).toBe(302);expect(response.headers.get('location')).toBe('/login');
 });
 it.each(['/examples','/privacy','/terms'])('does not serve the removed %s marketing page',async path=>{
  const response=await app.request(path,{headers:{accept:'text/html'}});
  expect(response.status).toBe(404);expect(response.headers.get('location')).toBeNull();
 });
});

 describe('signed-in login visits', () => {
  it.each([
    ['/login', '/'],
    ['/login?callbackUrl=%2Foauth%2Floopback%3Fstate%3Dstale', '/'],
    ['/login?callbackUrl=%2Flogin%2Fcli%3FcallbackUrl%3Dstale', '/'],
    ['/login?callbackUrl=%2Fa%2Fabc%3Fx%3D1%23edit', '/a/abc?x=1#edit'],
    ['/login?callbackUrl=https://evil.example', '/'],
    ['/login?callbackUrl=%2Flogin%3FcallbackUrl%3D%252Faccount', '/'],
  ])('redirects %s to %s before rendering', async (path, target) => {
    for (const method of ['GET', 'HEAD']) {
      const response = await app.request(request(path, { method, actor: { credential: 'session', userId: 'login-user', email: 'mxmx_test_login@example.test' } }));
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(target);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('retires the CLI login address for guests and signed-in viewers',async()=>{
    for(const method of ['GET','HEAD']) {
      expect((await app.request('/login/cli',{method})).status).toBe(404);
      expect((await app.request(request('/login/cli',{method,actor:{credential:'session',userId:'login-user',email:'mxmx_test_login@example.test'}}))).status).toBe(404);
    }
  });
  it('keeps the login form available to guests', async () => {
    const response = await app.request('/login?callbackUrl=/account');
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
 });
