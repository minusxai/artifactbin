import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mintAccountToken, request, useAppHarness } from './harness';
import { POST } from '@/app/api/artifacts/route';
import { GET as read, PUT } from '@/app/api/artifacts/[id]/route';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { GET as download } from '@/app/a/[id]/download/route';
import { artifactPageAnswer, framedDocumentSrc } from '@/lib/serving/artifact-page';
import { markPagesRequest, pagesSiteFor } from '@/lib/http/pages-origin';
import * as prepared from '@/lib/publish/prepared/prepared-page.server';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
const site=pagesSiteFor('pages.example.test','https://app.example.test');
const source='<!doctype html><html><head><title>Native plan</title><script type="application/json" data-af="state">{"count":3}</script><script type="module">import {client} from "@afbin/apollo"; document.body.dataset.ready="yes"</script></head><body><h1 data-af-id="title">Native content</h1></body></html>';
async function publish(visibility:'private'|'public'='private'){
 const actor=await mintAccountToken('native-serving');
 const response=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html:source,visibility}}));
 expect(response.status,await response.clone().text()).toBe(201);
 return {actor,id:(await response.json()).id as string};
}
it('serves native HTML after original ACL without calling JSX preparation',async()=>{
 const {actor,id}=await publish();
 const compiler=vi.spyOn(prepared,'preparedPageFor').mockRejectedValue(new Error('JSX must not render HTML'));
 try{
  expect((await raw(request(`/a/${id}/raw`),params(id))).status).toBe(404);
  const stranger=await mintAccountToken('stranger');expect((await raw(request(`/a/${id}/raw`,{token:stranger.token}),params(id))).status).toBe(404);
  const response=await raw(request(`/a/${id}/raw`,{token:actor.token}),params(id));expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
  const document=new JSDOM(await response.text()).window.document;
  expect(document.querySelector('h1')?.textContent).toBe('Native content');
  const runtime=JSON.parse(document.querySelector('[data-af="runtime"]')!.textContent!);
  expect(runtime).toMatchObject({pageId:id,revision:'1',initialState:{count:3},backends:[]});expect(runtime.appOrigin).toBeUndefined();expect(compiler).not.toHaveBeenCalled();
 }finally{compiler.mockRestore();}
});
it('uses original framed chrome without duplicating source in the bootstrap',async()=>{
 const {actor,id}=await publish();const req=()=>request(`/a/${id}`,{actor:{credential:'session',userId:actor.userId!,email:actor.email??undefined}});
 const answer=await artifactPageAnswer(req(),id,{pages:site});
 expect(answer.status).toBe(200);expect(answer.frame?.src).toContain('_pt=');expect(answer.frame?.head.title).toBe('Native plan');
 expect(answer.body).toMatchObject({surface:{format:'html',runtime:{title:'Native plan',data:{}}}});
 expect(JSON.stringify(answer.body)).not.toContain('<h1');expect(JSON.stringify(answer.body)).not.toContain('document.body.dataset');expect(await framedDocumentSrc(req(),id,site)).not.toBeNull();
});
it('revalidates only after access admission and admits native code only inside the runner policy',async()=>{
 const {actor,id}=await publish();
 const req=(token?:string,tag?:string)=>markPagesRequest(request(`/a/${id}/raw`,{...(token?{token}:{}),headers:tag?{'if-none-match':tag}:{}}),{id,self:`https://${id}.pages.example.test`,site});
 const first=await raw(req(actor.token),params(id));expect(first.status).toBe(200);const tag=first.headers.get('etag');expect(tag).toBeTruthy();
 const csp=first.headers.get('content-security-policy')!;expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);expect(csp).toMatch(/script-src[^;]*blob:/);expect(csp).toContain('frame-ancestors https://app.example.test');expect(csp).not.toMatch(/(?:^|;)\s*sandbox(?:;|\s|$)/);
 expect((await raw(req(actor.token,tag!),params(id))).status).toBe(304);expect((await raw(req(undefined,tag!),params(id))).status).toBe(404);
});
it('downloads real offline HTML and preserves authorized immutable history',async()=>{
 const {actor,id}=await publish();const head=await (await read(request(`/api/artifacts/${id}`,{token:actor.token}),params(id))).json();
 const changed=await PUT(request(`/api/artifacts/${id}`,{method:'PUT',token:actor.token,json:{html:head.html.replace('Native content','Updated content'),expectedVersion:head.version,expectedState:head.state}}),params(id));expect(changed.status).toBe(200);
 const archived=await raw(request(`/a/${id}/raw?version=1`,{token:actor.token}),params(id));expect(archived.status).toBe(200);expect(await archived.text()).toContain('Native content');expect((await raw(request(`/a/${id}/raw?version=1`),params(id))).status).toBe(404);
 expect((await download(request(`/a/${id}/download`),params(id))).status).toBe(404);
 const response=await download(request(`/a/${id}/download?version=1`,{token:actor.token}),params(id));expect(response.status).toBe(200);expect(response.headers.get('content-disposition')).toMatch(/attachment;.*\.html/);expect(response.headers.get('content-disposition')).not.toContain('.jsx.html');
 const html=await response.text(),document=new JSDOM(html).window.document;expect(document.querySelector('h1')?.textContent).toBe('Native content');const runtime=JSON.parse(document.querySelector('[data-af="runtime"]')!.textContent!);expect(runtime.offline).toBe(true);expect(runtime.appOrigin).toBeUndefined();expect(html).not.toContain('afbin-file');
});
it('serves public native HTML without credentials',async()=>{const {id}=await publish('public');expect((await raw(request(`/a/${id}/raw`),params(id))).status).toBe(200);});

import { fakeBrowser } from '@artifactbin/utils';
import { setServices } from '@/lib/platform';
import { GET as exportImage } from '@/app/a/[id]/export/route';
import { EXPORT_PNG } from './export-helpers';
import type { RenderRequest } from '@artifactbin/contracts';
afterEach(()=>setServices({}));
it('captures native HTML body through its signed raw URL and keeps private previews private',async()=>{
 const {actor,id}=await publish();const browser=fakeBrowser({ok:true,mime:'image/png',bytes:EXPORT_PNG});setServices({browser});
 expect((await exportImage(request(`/a/${id}/export?mode=preview`),params(id))).status).toBe(404);
 const response=await exportImage(request(`/a/${id}/export?mode=preview`,{token:actor.token}),params(id));expect(response.status).toBe(200);
 const capture=browser.calls.at(-1) as RenderRequest;expect(capture.selector).toBe('body');const shot=new URL(capture.url);expect(shot.pathname).toBe(`/a/${id}/raw`);expect(shot.searchParams.get('key')).toBeTruthy();
 const captured=await raw(request(shot.pathname+shot.search),params(id));expect(captured.status).toBe(200);expect(await captured.text()).toContain('Native content');
});
