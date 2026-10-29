/** Native pages use one isolated frame; retired source-editor addresses never open it. */
import {beforeEach,describe,expect,it} from 'vitest';
import {useAppHarness,request,setSession,mintAccountToken} from '@/__tests__/harness';
import {POST as createArtifactRoute} from '@/app/api/artifacts/route';
import {GET as rawRoute} from '@/app/a/[id]/raw/route';
import { artifactPageAnswer } from '@/lib/document-serving';
import {pagesSite} from '@/lib/http';
import { mintExportKey } from '@/lib/export';
import {artifactStarter} from '@/lib/workspace/artifact-starters';
useAppHarness();beforeEach(()=>setSession(null));
const PAGES={pages:pagesSite()};
const raw=(id:string,search='')=>rawRoute(request(`/a/${id}/raw${search}`),{params:Promise.resolve({id})});
async function publish(body:Record<string,unknown>){const {token}=await mintAccountToken('address');const made=await createArtifactRoute(request('/api/artifacts',{method:'POST',token,json:{visibility:'public',...body}}));expect(made.status,await made.clone().text()).toBe(201);return {id:(await made.json()).id as string,token};}
describe('native artifact addresses',()=>{
 it('frames a native starter through read aliases without exposing a source editor',async()=>{
  const {id,token}=await publish({...artifactStarter('doc'),visibility:'public'});
  const read=await artifactPageAnswer(request(`/a/${id}`,{token}),id,PAGES);expect(read.status).toBe(200);expect(read.frame?.src).toContain('_pt=');expect((read.body as {surface:{starter:boolean}}).surface.starter).toBe(false);
  const alias=await artifactPageAnswer(request(`/a/${id}/edit`,{token}),id,PAGES);expect(alias.status).toBe(200);expect(alias.frame?.src).toContain('_pt=');expect((alias.body as {surface:Record<string,unknown>}).surface.source).toBeUndefined();
 });
 it('captures the native starter as its actual standalone document',async()=>{
  const {id}=await publish({...artifactStarter('doc'),visibility:'public'});const capture=await raw(id,`?chrome=0&key=${mintExportKey(id)}`);expect(capture.status).toBe(200);expect(await capture.text()).toContain('Untitled document');
 });
 it('places content only in its own-origin frame rather than the app JSON answer',async()=>{
  const {id,token}=await publish({title:'Framed',html:'<h1>Framed heading</h1>'});const answer=await artifactPageAnswer(request(`/a/${id}`,{token}),id,PAGES);
  expect(answer.frame?.src).toMatch(/[?&]_pt=[A-Za-z0-9_-]+$/);expect(new URL(answer.frame!.src).host).toContain(`.${pagesSite().host}`);expect(answer.frame?.head.title).toBe('Framed');expect(JSON.stringify(answer.body)).not.toContain('Framed heading');expect((await artifactPageAnswer(request(`/a/${id}`,{token}),id)).frame).toBeUndefined();
 });
 it('captures native author HTML and core rather than the app shell',async()=>{
  const {id}=await publish({title:'Captured',html:'<h1>Captured heading</h1>'});const capture=await raw(id,`?chrome=0&key=${mintExportKey(id)}`);expect(capture.status).toBe(200);const html=await capture.text();expect(html).toContain('Captured heading');expect(html).toContain('data-af="core"');expect(html).not.toContain('data-mx-spa-idle');
 });
 it('refuses empty native source at publication instead of creating a fallback document',async()=>{
  const {token}=await mintAccountToken('address');const response=await createArtifactRoute(request('/api/artifacts',{method:'POST',token,json:{html:''}}));expect(response.status).toBe(400);expect(await response.json()).toHaveProperty('error');
 });
});
