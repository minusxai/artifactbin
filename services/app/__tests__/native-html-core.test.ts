import {expect,it} from 'vitest';
import {Hono} from 'hono';
import {GET,HEAD} from '@/app/af/v1/core.js/route';
import {pagesHost} from '../server/pages-host';
import {pagesOriginFor,pagesSiteFor} from '@/lib/http/pages-origin';
import {useAppHarness} from './harness';
useAppHarness();
it('serves the documented public core with credential-free conditional GET and HEAD',async()=>{
 const request=new Request('https://app.example.test/af/v1/core.js',{headers:{authorization:'Bearer ignored-test-value',cookie:'ignored=test'}});const get=await GET(request);expect(get.status).toBe(200);expect(get.headers.get('content-type')).toContain('javascript');expect(get.headers.get('set-cookie')).toBeNull();expect(get.headers.get('cache-control')).toContain('public');const source=await get.text();expect(source).toContain('@afbin/apollo');expect(()=>new Function(source)).not.toThrow();const tag=get.headers.get('etag')!;expect(tag).toBeTruthy();
 const head=await HEAD(new Request(request,{method:'HEAD'}));expect(head.status).toBe(200);expect(await head.text()).toBe('');expect(head.headers.get('etag')).toBe(tag);expect(Number(head.headers.get('content-length'))).toBe(new TextEncoder().encode(source).byteLength);
 const unchanged=await GET(new Request(request,{headers:{'if-none-match':tag}}));expect(unchanged.status).toBe(304);expect(await unchanged.text()).toBe('');expect(unchanged.headers.get('etag')).toBe(tag);
});
it('permits only the exact public runtime path on a page runner origin',async()=>{
 const site=pagesSiteFor('pages.example.test','https://app.example.test')!;const origin=pagesOriginFor('ABC123',site);const app=new Hono();app.use('*',pagesHost(site));app.get('/af/v1/core.js',c=>GET(c.req.raw));
 expect((await app.request(origin+'/af/v1/core.js')).status).toBe(200);expect((await app.request(origin+'/af/v1/core.js/private')).status).toBe(404);
});
