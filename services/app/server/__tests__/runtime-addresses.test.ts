import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {RUNTIME_MODULE_PATHS} from '@/lib/html-runtime/server';
import {createAppServer} from '../app';

useAppHarness();
const app=()=>createAppServer({indexHtml:async()=>'<html><head></head><body>APP</body></html>'});
const base='https://app.example.test';
it('serves each runtime module at a content address, immutable, and sends any other digest to the flat address',async()=>{
 const server=app();
 const files=Object.values(RUNTIME_MODULE_PATHS).map(path=>path.slice('/af/'.length));
 expect(files).toEqual(expect.arrayContaining(['apollo.js','reader.js','state.js']));
 for(const file of files){
  const flat=await server.request(`${base}/af/${file}`);expect(flat.status,file).toBe(200);
  expect(flat.headers.get('cache-control')).toBe('no-cache');
  const etag=flat.headers.get('etag');expect(etag).toBeTruthy();
  expect((await server.request(`${base}/af/${file}`,{headers:{'if-none-match':etag!}})).status).toBe(304);
  const bytes=Buffer.from(await flat.arrayBuffer()),digest=createHash('sha256').update(bytes).digest('hex');
  const pinned=await server.request(`${base}/af/v1/runtime/${digest}/${file}`);
  expect(pinned.status,file).toBe(200);
  expect(pinned.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect(pinned.headers.get('access-control-allow-origin')).toBe('*');
  expect(pinned.headers.get('x-content-type-options')).toBe('nosniff');
  expect(pinned.headers.get('content-type')).toMatch(/javascript/);
  expect(Buffer.from(await pinned.arrayBuffer()).equals(bytes)).toBe(true);
  const head=await server.request(`${base}/af/v1/runtime/${digest}/${file}`,{method:'HEAD'});
  expect(head.status).toBe(200);expect(await head.text()).toBe('');
  const stale=await server.request(`${base}/af/v1/runtime/${'0'.repeat(64)}/${file}`,{redirect:'manual'});
  expect(stale.status).toBe(302);expect(stale.headers.get('location')).toBe(`/af/${file}`);
  expect(stale.headers.get('cache-control')).toBe('no-store');expect(stale.headers.get('access-control-allow-origin')).toBe('*');
 }
 expect((await server.request(`${base}/af/v1/runtime/${'0'.repeat(64)}/nothing.js`)).status).toBe(404);
 expect((await server.request(`${base}/af/v1/runtime/${'0'.repeat(64)}/offline-sql.js`)).status).toBe(404);
 expect((await server.request(`${base}/af/v1/runtime/${'0'.repeat(64)}/host.js`)).status).toBe(404);
});
