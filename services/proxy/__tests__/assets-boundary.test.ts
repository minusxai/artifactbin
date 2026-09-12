import {describe,it,expect,vi} from 'vitest';
import {createProxy} from '../src/parts';
import {testProxyOptions} from './helpers';
const main='https://example.test',controls='https://i.example.test',assets='https://assets.example.test',path='/assets/'+'a'.repeat(64);
describe('credential-free public asset host',()=>{
 it('forwards only public byte reads without resolving or forwarding credentials',async()=>{
  const session=vi.fn(async()=>({userId:'secret'}));
  const seen:unknown[]=[];
  const options=await testProxyOptions({sessions:{resolve:session},upstream:async(request,actor)=>{seen.push({actor,cookie:request.headers.get('cookie'),authorization:request.headers.get('authorization')});return new Response('bytes',{headers:{'set-cookie':'leak=yes','content-type':'application/javascript'}});}});
  options.env={...options.env,APP__PUBLIC_BASE_URL:main,APP__ASSETS_ORIGIN:assets};
  const proxy=createProxy(options);
  const res=await proxy.request(assets+path,{headers:{cookie:'session=secret',authorization:'Bearer secret',origin:'null'}});
  expect(res.status).toBe(200);expect(await res.text()).toBe('bytes');expect(session).not.toHaveBeenCalled();
  expect(seen).toEqual([{actor:{credential:'none'},cookie:null,authorization:null}]);
  expect(res.headers.get('set-cookie')).toBeNull();expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('content-security-policy')).toBe('sandbox');expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  for(const [route,method] of [[path,'POST'],['/api/auth/get-session','GET'],['/a/abc123/assets?u=https://example.test','GET'],['/a/abc123/resolve?ref=ref:abc123','GET'],[path+'?url=https://evil.test','GET']])expect((await proxy.request(assets+route,{method})).status).toBe(404);
  expect(seen).toHaveLength(1);
 });
 it('refuses redirects returned by the upstream even at an allowed path',async()=>{
  const options=await testProxyOptions({upstream:async()=>Response.redirect(controls+'/login')});
  options.env={...options.env,APP__PUBLIC_BASE_URL:main,APP__ASSETS_ORIGIN:assets};
  const res=await createProxy(options).request(assets+path);expect(res.status).toBe(502);expect(res.headers.get('location')).toBeNull();
 });
 it('accepts TLS-terminated byte requests using the deployment-owned host and scheme',async()=>{
  const options=await testProxyOptions({upstream:async()=>new Response('bytes')});
  options.env={...options.env,APP__PUBLIC_BASE_URL:main,APP__ASSETS_ORIGIN:assets};
  const res=await createProxy(options).request('http://assets.example.test'+path);
  expect(res.status).toBe(200);
 });
});

describe('manifest-confirmed build files on the app origin', () => {
 it('strips caller authority before probing and strips response authority before returning public bytes', async () => {
  const session = vi.fn(async () => null);
  const seen: unknown[] = [];
  const options = await testProxyOptions({ sessions: { resolve: session }, upstream: async (request, actor) => {
   seen.push({ path: new URL(request.url).pathname, actor, headers: Object.fromEntries(request.headers) });
   return new Response('public code', { headers: { 'x-artifactbin-build-asset': '1', 'content-type': 'text/javascript', 'set-cookie': 'secret=1', location: '/private', 'access-control-allow-credentials': 'true', 'x-private': 'secret' } });
  } });
  const res = await createProxy(options).request('/assets/app-abc.js', { headers: { cookie: 'secret', authorization: 'Bearer secret', 'x-mx-actor': 'forged', 'x-real-ip': 'forged', 'x-forwarded-host': 'evil.test', 'x-forwarded-for': 'forged', 'x-forwarded-proto': 'https', 'x-artifactbin-build-asset': '1', range: 'bytes=0-10' } });
  expect(seen).toEqual([{ path: '/api/internal/build-assets/assets/app-abc.js', actor: { credential: 'none' }, headers: { range: 'bytes=0-10' } }]);
  expect(await res.text()).toBe('public code'); expect(session).not.toHaveBeenCalled();
  for (const name of ['set-cookie', 'location', 'access-control-allow-credentials', 'x-private', 'x-artifactbin-build-asset']) expect(res.headers.get(name)).toBeNull();
 });
 it('falls back through identity for unmarked replies, redirects, wrong MIME and upstream errors', async () => {
  for (const result of ['unmarked', 'redirect', 'html', 'error']) {
   const session = vi.fn(async () => null);
   const options = await testProxyOptions({ sessions: { resolve: session }, upstream: async request => {
    if (!new URL(request.url).pathname.startsWith('/api/internal/build-assets/')) return new Response('normal access denied', { status: 403 });
    if (result === 'error') throw Error('upstream unavailable');
    return new Response('not public bytes', { status: result === 'redirect' ? 302 : 200, headers: { 'content-type': result === 'html' ? 'text/html' : 'text/javascript', ...(result !== 'unmarked' ? { 'x-artifactbin-build-asset': '1' } : {}), ...(result === 'redirect' ? { location: '/private' } : {}) } });
   } });
   const res = await createProxy(options).request('/assets/app-abc.js', { headers: { 'x-artifactbin-build-asset': '1' } });
   expect(res.status).toBe(403); expect(await res.text()).toBe('normal access denied'); expect(session).toHaveBeenCalledOnce();
  }
 });
 it('does not probe protected routes, encoded paths, query variants or write methods', async () => {
  const seen: string[] = [], session = vi.fn(async () => null);
  const options = await testProxyOptions({ sessions: { resolve: session }, upstream: async request => { seen.push(new URL(request.url).pathname); return new Response('denied', { status: 403 }); } });
  const proxy = createProxy(options);
  const cases = [['/a/abc123', 'GET'], ['/datasets/abc123', 'GET'], ['/assets/ref/abc123', 'GET'], ['/assets/app-abc.js?token=secret', 'GET'], ['/assets/%61pp-abc.js', 'GET'], ['/assets/app-abc.js', 'POST']];
  for (const [url, method] of cases) expect((await proxy.request(url, { method })).status).toBe(403);
  expect(session).toHaveBeenCalledTimes(cases.length);
  expect(seen.every(p => !p.startsWith('/api/internal/'))).toBe(true);
 });
});
