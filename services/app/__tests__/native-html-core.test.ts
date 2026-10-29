import {createHash} from 'node:crypto';
import {retainedRuntimeAssets, buildHtmlAssets} from '@/lib/html-runtime/server';
import {GET as apollo} from '@/app/af/v1/apollo/[digest]/route';
import {expect,it} from 'vitest';
import {Hono} from 'hono';
import {GET,HEAD} from '@/app/af/core.js/route';
import {GET as legacyCore} from '@/app/af/v1/core.js/route';
import {GET as flatApollo} from '@/app/af/apollo.js/route';
import {GET as flatReader,HEAD as flatReaderHead} from '@/app/af/reader.js/route';
import {GET as flatMorph} from '@/app/af/morph.js/route';
import {GET as font,HEAD as fontHead} from '@/app/af/fonts/[name]/route';
import {readFileSync} from 'node:fs';
import { storyFontManifest as manifest } from '@/lib/data';
import {pagesHost} from '../server/pages-host';
import {pagesOriginFor,pagesSiteFor} from '@/lib/http/pages-origin';
import {useAppHarness} from './harness';
useAppHarness();
it('serves the documented public core with credential-free conditional GET and HEAD',async()=>{
 const request=new Request('https://app.example.test/af/core.js',{headers:{authorization:'Bearer ignored-test-value',cookie:'ignored=test'}});const get=await GET(request);expect(get.status).toBe(200);expect(get.headers.get('content-type')).toContain('javascript');expect(get.headers.get('set-cookie')).toBeNull();expect(get.headers.get('cache-control')).toBe('no-cache');const source=await get.text();expect(source).toContain('@afbin/apollo');expect(()=>new Function(source)).not.toThrow();const tag=get.headers.get('etag')!;expect(tag).toBeTruthy();
 const head=await HEAD(new Request(request,{method:'HEAD'}));expect(head.status).toBe(200);expect(await head.text()).toBe('');expect(head.headers.get('etag')).toBe(tag);expect(Number(head.headers.get('content-length'))).toBe(new TextEncoder().encode(source).byteLength);
 const unchanged=await GET(new Request(request,{headers:{'if-none-match':tag}}));expect(unchanged.status).toBe(304);expect(await unchanged.text()).toBe('');expect(unchanged.headers.get('etag')).toBe(tag);
 // The pre-D17 address stays an alias for pages and caches that still name it.
 const legacy=await legacyCore(new Request('https://app.example.test/af/v1/core.js'));expect(await legacy.text()).toBe(source);expect(legacy.headers.get('etag')).toBe(tag);
});
it('permits only the exact public runtime path on a page runner origin',async()=>{
 const site=pagesSiteFor('pages.example.test','https://app.example.test')!;const origin=pagesOriginFor('ABC123',site);const app=new Hono();app.use('*',pagesHost(site));app.get('/af/core.js',c=>GET(c.req.raw));app.get('/af/v1/core.js',c=>GET(c.req.raw));
 expect((await app.request(origin+'/af/core.js')).status).toBe(200);expect((await app.request(origin+'/af/v1/core.js')).status).toBe(200);expect((await app.request(origin+'/af/core.js/private')).status).toBe(404);
});

it('serves the flat runtime modules at stable addresses, revalidated by ETag, each guarded against another build\'s core',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.apolloPath).toBe('/af/apollo.js');expect(assets.readerPath).toBe('/af/reader.js');expect(assets.morphPath).toBe('/af/morph.js');
 const build=/globalThis\[Symbol\.for\("afbin\.runtime-build"\)\]="([a-f0-9]{16})"/.exec(assets.core)?.[1];expect(build).toBeTruthy();
 for(const source of [assets.apollo,assets.reader,assets.chrome!,assets.portableEngine!,assets.morph!])expect(source.startsWith(`{const c=globalThis[Symbol.for("afbin.runtime-build")];if(c&&c!=="${build}")`)).toBe(true);
 for(const [route,source] of [[flatApollo,assets.apollo],[flatMorph,assets.morph!]] as const){const response=await route(new Request('https://app.example.test/af/x.js',{headers:{cookie:'ignored=test'}}));expect(response.status).toBe(200);expect(await response.text()).toBe(source);expect(response.headers.get('cache-control')).toBe('no-cache');expect(response.headers.get('set-cookie')).toBeNull();}
 const read=await flatReader(new Request('https://app.example.test/af/reader.js'));const tag=read.headers.get('etag')!;expect(await read.text()).toBe(assets.reader);
 const head=await flatReaderHead(new Request('https://app.example.test/af/reader.js',{method:'HEAD'}));expect(await head.text()).toBe('');expect(head.headers.get('etag')).toBe(tag);
 expect((await flatReader(new Request('https://app.example.test/af/reader.js',{headers:{'if-none-match':tag}}))).status).toBe(304);
 const site=pagesSiteFor('pages.example.test','https://app.example.test')!,origin=pagesOriginFor('ABC123',site),app=new Hono();app.use('*',pagesHost(site));app.get('/af/reader.js',c=>flatReader(c.req.raw));
 expect((await app.request(origin+'/af/reader.js')).status).toBe(200);expect((await app.request(origin+'/af/secret.js')).status).toBe(404);
});

it('serves registered platform fonts by plain name, immutable, and nothing else',async()=>{
 const face=manifest.systems['DM Sans'][0]!,name=face.url.split('/').at(-1)!.replace(/\.[a-f0-9]{8}\.woff2$/,'.woff2');
 const request=new Request('https://app.example.test/af/fonts/'+name);
 const response=await font(request,{params:Promise.resolve({name})});expect(response.status).toBe(200);
 expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');expect(response.headers.get('content-type')).toBe('font/woff2');
 expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync('public'+face.url));
 const head=await fontHead(new Request(request,{method:'HEAD'}),{params:Promise.resolve({name})});expect(await head.text()).toBe('');
 for(const bad of ['../secret.woff2',face.url.split('/').at(-1)!,'unknown-font.woff2'])expect((await font(request,{params:Promise.resolve({name:bad})})).status).toBe(404);
 const site=pagesSiteFor('pages.example.test','https://app.example.test')!,origin=pagesOriginFor('ABC123',site),app=new Hono();app.use('*',pagesHost(site));app.get('/af/fonts/:name',c=>font(c.req.raw,{params:Promise.resolve({name:c.req.param('name')})}));
 expect((await app.request(origin+'/af/fonts/'+name)).status).toBe(200);
});

it('serves only the content-addressed legacy author module, cacheable without page state or credentials',async()=>{
 const assets=await buildHtmlAssets(),digest=createHash('sha256').update(assets.apollo).digest('hex'),legacyPath='/af/v1/apollo/'+digest;
 const req=new Request('https://app.example.test'+legacyPath);
 const response=await apollo(req,{params:Promise.resolve({digest})});
 expect(response.status).toBe(200);expect(await response.text()).toBe(assets.apollo);
 expect(response.headers.get('cache-control')).toContain('immutable');expect(response.headers.get('set-cookie')).toBeNull();
 expect((await apollo(req,{params:Promise.resolve({digest:'0'.repeat(64)})})).status).toBe(404);
 const site=pagesSiteFor('pages.example.test','https://app.example.test')!,origin=pagesOriginFor('ABC123',site),app=new Hono();app.use('*',pagesHost(site));app.get('/af/v1/apollo/:digest',c=>apollo(c.req.raw,{params:Promise.resolve({digest:c.req.param('digest')})}));
 expect((await app.request(origin+legacyPath)).status).toBe(200);
 expect((await app.request(origin+'/af/v1/apollo/private')).status).toBe(404);
});

it('serves retained prior-release author bytes and refuses a corrupt stored content address',async()=>{
 const previous='export const priorRelease=true;',digest=createHash('sha256').update(previous).digest('hex');
 await retainedRuntimeAssets.put(digest,previous);
 const req=new Request(`https://app.example.test/af/v1/apollo/${digest}`);
 const response=await apollo(req,{params:Promise.resolve({digest})});
 expect(response.status).toBe(200);expect(await response.text()).toBe(previous);expect(response.headers.get('cache-control')).toContain('immutable');
 const corrupt=createHash('sha256').update('expected immutable bytes').digest('hex');
 await retainedRuntimeAssets.put(corrupt,'different bytes');
 expect((await apollo(req,{params:Promise.resolve({digest:corrupt})})).status).toBe(404);
});

import {GET as reader,HEAD as readerHead} from '@/app/af/v1/reader/[digest]/route';
it('serves retained immutable reader code on the exact public runner path for GET and HEAD',async()=>{
 const assets=await buildHtmlAssets(),digest=createHash('sha256').update(assets.reader).digest('hex'),legacyPath='/af/v1/reader/'+digest;
 const request=new Request('https://app.example.test'+legacyPath,{headers:{cookie:'ignored=test'}});
 const response=await reader(request,{params:Promise.resolve({digest})});
 expect(response.status).toBe(200);expect(await response.text()).toBe(assets.reader);
 expect(response.headers.get('cache-control')).toContain('immutable');expect(response.headers.get('set-cookie')).toBeNull();
 const head=await readerHead(new Request(request,{method:'HEAD'}),{params:Promise.resolve({digest})});expect(await head.text()).toBe('');expect(head.headers.get('etag')).toBe(response.headers.get('etag'));
 expect((await reader(new Request(request,{headers:{'if-none-match':response.headers.get('etag')!}}),{params:Promise.resolve({digest})})).status).toBe(304);
 const site=pagesSiteFor('pages.example.test','https://app.example.test')!,origin=pagesOriginFor('ABC123',site),app=new Hono();app.use('*',pagesHost(site));app.get('/af/v1/reader/:digest',c=>reader(c.req.raw,{params:Promise.resolve({digest:c.req.param('digest')})}));
 expect((await app.request(origin+legacyPath)).status).toBe(200);expect((await app.request(origin+'/af/v1/reader/private')).status).toBe(404);
 const previous='export const priorReader=true;',oldDigest=createHash('sha256').update(previous).digest('hex');await retainedRuntimeAssets.put(oldDigest,previous);
 expect(await (await reader(request,{params:Promise.resolve({digest:oldDigest})})).text()).toBe(previous);
});
