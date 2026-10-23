/** Native authors own CSS/font declarations. Serving preserves them without a
 * publish-time fetch, held copy or a retired Helmet font metadata compiler. */
import {describe,expect,it} from 'vitest';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {POST as create} from '@/app/api/artifacts/route';
import {getDb} from '@/lib/platform/db';
import {mintAccountToken,request,useAppHarness} from './harness';
useAppHarness();
const source=(css:string)=>`<!doctype html><html><head><style>${css}</style></head><body><h1>Headlined</h1><p>Body</p></body></html>`;
async function publish(html:string){const token=await mintAccountToken('native-font');const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html,visibility:'public'}}));expect(response.status).toBe(201);return response.json()}
describe('native font CSS',()=>{
 it('keeps a Google import first in its authored stylesheet, with no fetched or stored copy',async()=>{
  const css='@import url(https://fonts.googleapis.com/css2?family=Lobster&display=swap);h1{font-family:"Lobster",serif}';const page=await publish(source(css));
  expect((await(await getDb()).query('SELECT 1 FROM web_assets')).rows).toHaveLength(0);
  const response=await raw(request(`/a/${page.id}/raw`),{params:Promise.resolve({id:page.id})});expect(response.status).toBe(200);const html=await response.text();expect(html).toMatch(/<style[^>]*>@import/);expect(html).toContain(css);expect(html).not.toContain('/webfonts/');expect(html).not.toMatch(/rel="preload" href="https:\/\/fonts\./);
  const csp=response.headers.get('content-security-policy')!;expect(csp).toContain('https://fonts.googleapis.com');expect(csp).toContain('https://fonts.gstatic.com');
 });
 it('leaves font-name resolution to the authored remote sheet without a publish-time lookup',async()=>{
  await publish(source('@import url(https://fonts.googleapis.com/css2?family=Not+A+Real+Font);'));expect((await(await getDb()).query('SELECT 1 FROM web_assets')).rows).toHaveLength(0);
 });
 it('preserves a normal local font declaration without injecting a remote import',async()=>{
  const page=await publish(source('body{font-family:"JetBrains Mono",monospace}'));const response=await raw(request(`/a/${page.id}/raw`),{params:Promise.resolve({id:page.id})});const html=await response.text();expect(html).toContain('font-family:"JetBrains Mono",monospace');expect(html).not.toContain('fonts.googleapis.com/css2');
 });
});
