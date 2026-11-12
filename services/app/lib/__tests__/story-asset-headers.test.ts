/** Native runtime code is public, CORS-open and revalidated across deployments. */
import {describe,expect,it} from 'vitest';
import {createAppServer} from '@/server/app';
const app=createAppServer({indexHtml:async()=>'<html></html>'});
describe('native runtime assets',()=>{
 it('does not serve the retired region runtime',async()=>{
  expect((await app.request('/af/regions.js')).status).toBe(404);
 });
 it.each(['/af/core.js','/af/reader.js','/af/apollo.js','/af/morph.js','/af/native-regions.js','/af/native-markdown.js'])('%s is CORS-open and revalidates without a response body',async path=>{
  const response=await app.request(path);expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('javascript');
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.get('cache-control')).not.toContain('immutable');
  expect((await response.text()).length).toBeGreaterThan(100);
  const tag=response.headers.get('etag');expect(tag).toBeTruthy();
  const cached=await app.request(path,{headers:{'if-none-match':tag!}});
  expect(cached.headers.get('access-control-allow-origin')).toBe('*');
  expect(cached.headers.get('etag')).toBe(tag);
  expect(cached.status).toBe(304);expect(await cached.text()).toBe('');
 });
});
