/** Native head scripts/styles replace retired Helmet hoisting and JSX restrictions. */
import {describe,expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
useAppHarness();
const page=(head:string,body='<h1>Hello</h1>')=>`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
async function publish(html:string,title?:string){
 const token=await mintAccountToken('native-head');
 return create(request('/api/artifacts',{method:'POST',token:token.token,json:{html,...(title?{title}:{})}}));
}
describe('native head publication',()=>{
 it('preserves authored head and body scripts after core, along with external CSS imports',async()=>{
  const html=page('<title>Scripted page</title><style>@import url("https://fonts.example/x.css"); h1 { color: red; }</style><script>document.body.dataset.ready="1"</script>','<h1>Hello</h1><script>console.log("body")</script>');
  const response=await publish(html);expect(response.status).toBe(201);
  const wire=await response.json();expect(wire.title).toBe('Scripted page');
  expect(wire.html).toContain('@import url("https://fonts.example/x.css"); h1 { color: red; }');
  expect(wire.html).toContain('console.log("body")');
  expect(wire.html.indexOf('/af/v1/core.js')).toBeLessThan(wire.html.indexOf('document.body.dataset.ready'));
 });
 it('an explicit request title wins over the native head title',async()=>{
  const response=await publish(page('<title>Source title</title>'),'Named by hand');
  expect(response.status).toBe(201);expect((await response.json()).title).toBe('Named by hand');
 });
 it('canonical source is a fixpoint including allocated identities and exactly one core',async()=>{
  const first=await publish(page('<title>Stable</title>'));expect(first.status).toBe(201);
  const canonical=(await first.json()).html;
  const second=await publish(canonical);expect(second.status).toBe(201);
  expect((await second.json()).html).toBe(canonical);
  expect(canonical.match(/src="\/af\/v1\/core.js"/g)).toHaveLength(1);
 });
});
