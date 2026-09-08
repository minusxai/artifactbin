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
