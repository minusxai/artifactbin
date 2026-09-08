import {it,expect,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({...await original<typeof import('@/lib/config')>(),get PUBLIC_BASE_URL(){return 'https://example.test';},ASSETS_ORIGIN:'https://a.example.test'}));
import {createAppServer,APP_CSP} from '../app';
import {proxyRequest} from './proxy-request';
import {useAppHarness} from '@/__tests__/harness';
import {libraryUrls} from '@/lib/libraries';
useAppHarness();
const app=createAppServer({indexHtml:async()=>'<html><head></head><body><div id="root"></div></body></html>'});
it('serves only a fixed opaque wrapper with independent restrictive policy',async()=>{
 const response=await proxyRequest(app,'https://example.test/story/author-frame?source=evil',{headers:{cookie:'secret=private'}});
 expect(response.status).toBe(200);const body=await response.text();
 expect(body).toContain('data-mx-author-wrapper');expect(body).not.toContain('evil');expect(body).not.toContain('secret');
 const csp=response.headers.get('content-security-policy')!;
 expect(csp).toContain('sandbox allow-scripts');expect(csp).not.toContain('allow-same-origin');
 // Raw/capture parents have opaque sandbox origins. This fixed, powerless
 // document must work there too; its response sandbox remains mandatory.
 expect(csp).not.toContain('frame-ancestors');
 expect(response.headers.get('x-frame-options')).toBeNull();
 for(const directive of ["frame-src 'none'","form-action 'none'","base-uri 'none'","object-src 'none'","worker-src 'none'"])expect(csp).toContain(directive);
 expect(csp).toContain("script-src 'unsafe-inline' https://a.example.test");
 expect(csp).toContain('connect-src https://a.example.test');
 expect(APP_CSP).not.toContain("'unsafe-inline' https://a.example.test");
 expect(response.headers.get('set-cookie')).toBeNull();
 expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 expect(response.headers.get('cache-control')).toContain('must-revalidate');
 const etag=response.headers.get('etag');expect(etag).toBeTruthy();
 const cached=await proxyRequest(app,'https://example.test/story/author-frame',{headers:{'if-none-match':etag!}});
 expect(cached.status).toBe(304);expect(await cached.text()).toBe('');expect(cached.headers.get('content-security-policy')).toBe(csp);
 expect((await app.request('https://example.test/story/author-frame')).status).toBe(403);
 expect((await app.request('https://a.example.test/story/author-frame')).status).toBe(404);
});
it('narrows legacy resolver network access to an exact validated artifact id',async()=>{
 for(const artifact of ['../login','Ab3xK9/resolve','Ab3xK9%2f..','Ab3xK9?x','https://evil.test','Ab3xK9;script-src *']){
  expect((await proxyRequest(app,'https://example.test/story/author-frame?artifact='+encodeURIComponent(artifact))).status).toBe(404);
 }
 expect((await proxyRequest(app,'https://example.test/story/author-frame?artifact=Ab3xK9&artifact=Cd4yL0')).status).toBe(404);
 const response=await proxyRequest(app,'https://example.test/story/author-frame?artifact=Ab3xK9');
 expect(response.status).toBe(200);const csp=response.headers.get('content-security-policy')!;
 const connect=csp.split('; ').find(d=>d.startsWith('connect-src'))!.split(' ');
 expect(connect).toContain('https://example.test/a/Ab3xK9/resolve');expect(connect).not.toContain('https://example.test/a/');expect(connect).not.toContain('https://example.test');
 const script=csp.split('; ').find(d=>d.startsWith('script-src'))!.split(' ');
 for(const url of Object.values(libraryUrls('https://example.test')))expect(script).toContain(url);
 const plain=await proxyRequest(app,'https://example.test/story/author-frame');
 expect(plain.headers.get('content-security-policy')).not.toContain('/a/Ab3xK9/resolve');
 expect(plain.headers.get('etag')).not.toBe(response.headers.get('etag'));
});
