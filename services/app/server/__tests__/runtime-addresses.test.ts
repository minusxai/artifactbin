import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {createAppServer} from '../app';

useAppHarness();
const app=()=>createAppServer({indexHtml:async()=>'<html><head></head><body>APP</body></html>'});
const base='https://app.example.test';
it('serves each runtime module at a content address, immutable, and sends any other digest to the flat address',async()=>{
 const server=app();
 for(const file of ['apollo.js','reader.js','state.js']){
  const flat=await server.request(`${base}/af/${file}`);expect(flat.status).toBe(200);
  expect(flat.headers.get('cache-control')).toBe('no-cache');
  const bytes=Buffer.from(await flat.arrayBuffer()),digest=createHash('sha256').update(bytes).digest('hex');
  const pinned=await server.request(`${base}/af/v1/runtime/${digest}/${file}`);
  expect(pinned.status).toBe(200);
  expect(pinned.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect(pinned.headers.get('access-control-allow-origin')).toBe('*');
  expect(Buffer.from(await pinned.arrayBuffer()).equals(bytes)).toBe(true);
  const stale=await server.request(`${base}/af/v1/runtime/${'0'.repeat(64)}/${file}`,{redirect:'manual'});
  expect(stale.status).toBe(302);expect(stale.headers.get('location')).toBe(`/af/${file}`);
  expect(stale.headers.get('cache-control')).toBe('no-store');
 }
 expect((await server.request(`${base}/af/v1/runtime/${'0'.repeat(64)}/nothing.js`)).status).toBe(404);
});
