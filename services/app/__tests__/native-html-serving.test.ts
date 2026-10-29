import * as nativeHtml from '@/lib/document-serving/native-html.server';
import { nativeHtmlStructuralWrapper } from '@/lib/document-serving/native-html-structural-wrapper';
import * as artifacts from '@/lib/artifacts';
import { HEAD as rawHead } from '@/app/a/[id]/raw/route';
import { servesDocument } from '@/lib/custom-domains';
import { getDb } from '@/lib/platform/db';
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mintAccountToken, request, useAppHarness } from './harness';
import { POST } from '@/app/api/artifacts/route';
import { GET as read, PUT, PATCH } from '@/app/api/artifacts/[id]/route';
import { GET as raw } from '@/app/a/[id]/raw/route';
import { GET as download } from '@/app/a/[id]/download/route';
import { GET as systemsSheet, HEAD as systemsHead } from '@/app/af/styles.css/route';
import { PLATFORM_STYLES_PATH } from '@/lib/html-systems';
import { buildHtmlAssets } from '@/lib/html-runtime/server';
import { artifactPageAnswer, framedDocumentSrc } from '@/lib/document-serving';
import { markPagesRequest, pagesSiteFor } from '@/lib/http/pages-origin';
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

  expect((await raw(request(`/a/${id}/raw`),params(id))).status).toBe(404);
  const stranger=await mintAccountToken('stranger');expect((await raw(request(`/a/${id}/raw`,{token:stranger.token}),params(id))).status).toBe(404);
  const response=await raw(request(`/a/${id}/raw`,{token:actor.token}),params(id));expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
  const document=new JSDOM(await response.text()).window.document;
  expect(document.querySelector('h1')?.textContent).toBe('Native content');
  const runtime=JSON.parse(document.querySelector('[data-af="runtime"]')!.textContent!);
  expect(runtime).toMatchObject({pageId:id,revision:'1',initialState:{count:3},backends:[]});expect(runtime.appOrigin).toBeUndefined();
});
it('uses original framed chrome without duplicating source in the bootstrap',async()=>{
 const {actor,id}=await publish();const req=()=>request(`/a/${id}`,{actor:{credential:'session',userId:actor.userId!,email:actor.email??undefined}});
 const answer=await artifactPageAnswer(req(),id,{pages:site});
 expect(answer.status).toBe(200);expect(answer.frame?.src).toContain('_pt=');expect(answer.frame?.head.title).toBe('Native plan');
 expect(answer.body).toMatchObject({surface:{format:'html',runtime:{title:'Native plan',data:{}}}});
 expect(JSON.stringify(answer.body)).not.toContain('<h1');expect(JSON.stringify(answer.body)).not.toContain('document.body.dataset');expect(await framedDocumentSrc(req(),id,site)).not.toBeNull();
});
it('keeps the compiler-owned mx-doc wrapper out of the bare story gutter in reader presentation',async()=>{
 const actor=await mintAccountToken('native-structural-wrapper');
 const original='<!doctype html><html><head><style data-mx-bare-type>:where([data-mx-story-root]:not([data-mx-styled]))>*{padding-inline:clamp(1rem,5vw,3rem)}:where([data-mx-story-root]:not([data-mx-styled]))>*:first-child{padding-block-start:2.5rem}:where([data-mx-story-root]:not([data-mx-styled]))>*:last-child{padding-block-end:3rem}</style></head><body><div id="mx-story-root" data-mx-inline-story data-mx-story-root><div class="mx-doc"><article data-af-id="authored"><h1>Authored heading</h1></article></div></div></body></html>';
 const created=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html:original,visibility:'private'}}));
 expect(created.status,await created.clone().text()).toBe(201);const {id}=await created.json() as {id:string};
 const rendered=await raw(request(`/a/${id}/raw`,{token:actor.token}),params(id));expect(rendered.status).toBe(200);
 const document=new JSDOM(await rendered.text()).window.document;
 const fix=document.querySelector('style[data-mx-native-html-presentation]');
 expect(fix?.textContent).toContain(':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled]))>.mx-doc');
 expect(fix?.textContent).toContain('padding-inline:0');
 expect(document.querySelector('[data-af-id="authored"] h1')?.textContent).toBe('Authored heading');
 const offline=await download(request(`/a/${id}/download`,{token:actor.token}),params(id));expect(offline.status).toBe(200);
 const offlineDocument=new JSDOM(await offline.text()).window.document,offlineFix=offlineDocument.querySelector('style[data-mx-native-html-presentation]');
 expect(offlineFix?.textContent).toContain(':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled]))>.mx-doc');
 expect(offlineDocument.querySelector('[data-af-id="authored"] h1')?.textContent).toBe('Authored heading');
 for(const renderedDocument of [document,offlineDocument]){
  const nonce=renderedDocument.querySelector<HTMLScriptElement>('script[data-af="core"]')?.nonce;
  expect(nonce).toMatch(/^[a-f0-9]{32}$/);
  expect(renderedDocument.querySelector('meta[data-af="script-policy"]')?.getAttribute('content')).toContain("'nonce-"+nonce+"'");
 }
 const stored=await read(request(`/api/artifacts/${id}`,{token:actor.token}),params(id));expect(stored.status).toBe(200);
 expect((await stored.json()).html).not.toContain('data-mx-native-html-presentation');
});
it('revalidates only after access admission and admits native code only inside the runner policy',async()=>{
 const {actor,id}=await publish();
 const req=(token?:string,tag?:string)=>markPagesRequest(request(`/a/${id}/raw`,{...(token?{token}:{}),headers:tag?{'if-none-match':tag}:{}}),{id,self:`https://${id}.pages.example.test`,site});
 const first=await raw(req(actor.token),params(id));expect(first.status).toBe(200);const tag=first.headers.get('etag');expect(tag).toBeTruthy();
 expect(tag).toMatch(/^W\//);
 const firstNonce=new JSDOM(await first.text()).window.document.querySelector<HTMLScriptElement>('script[data-af="core"]')!.nonce;
 const next=await raw(req(actor.token),params(id));expect(next.headers.get('etag')).toBe(tag);
 const nextNonce=new JSDOM(await next.text()).window.document.querySelector<HTMLScriptElement>('script[data-af="core"]')!.nonce;
 expect(firstNonce).toMatch(/^[a-f0-9]{32}$/);expect(nextNonce).not.toBe(firstNonce);
 expect((await raw(req(actor.token,tag!.replace(/^W\//,'')),params(id))).status).toBe(304);
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
it('resets only the bare inline story wrapper and preserves authored descendants', async()=>{
 const html='<!doctype html><html><head></head><body>'
  +'<main data-mx-story-root data-mx-inline-story><div class="mx-doc" id="reader-wrapper"><p id="author-content" style="padding-inline:12px">Text</p></div></main>'
  +'<main data-mx-story-root><div class="mx-doc" id="unrelated-wrapper"><p>Unrelated</p></div></main>'
  +'<main data-mx-story-root data-mx-inline-story data-mx-styled><div class="mx-doc" id="styled-wrapper"><p>Styled</p></div></main>'
  +'</body></html>';
 const rendered=nativeHtmlStructuralWrapper(html);
 const rerendered=nativeHtmlStructuralWrapper(rendered);
 const document=new JSDOM(rendered).window.document;
 const presentation=document.querySelector('style[data-mx-native-html-presentation]')!;
 expect(presentation).not.toBeNull();
 const reset=':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled]))>.mx-doc';
 expect(presentation.textContent).toContain(`${reset}{padding-inline:0;padding-block-start:0;padding-block-end:0}`);
 expect([...document.querySelectorAll(reset)].map(node=>node.id)).toEqual(['reader-wrapper']);
 expect(document.querySelector('#author-content')?.getAttribute('style')).toBe('padding-inline:12px');
 expect(html).not.toContain('data-mx-native-html-presentation');
 expect(rerendered).toBe(rendered);
 expect(new JSDOM(rerendered).window.document.querySelectorAll('style[data-mx-native-html-presentation]')).toHaveLength(1);
});
it('captures native HTML body through its signed raw URL and keeps private previews private',async()=>{
 const {actor,id}=await publish();const browser=fakeBrowser({ok:true,mime:'image/png',bytes:EXPORT_PNG});setServices({browser});
 expect((await exportImage(request(`/a/${id}/export?mode=preview`),params(id))).status).toBe(404);
 const response=await exportImage(request(`/a/${id}/export?mode=preview`,{token:actor.token}),params(id));expect(response.status).toBe(200);
 const capture=browser.calls.at(-1) as RenderRequest;expect(capture.selector).toBe('body');const shot=new URL(capture.url);expect(shot.pathname).toBe(`/a/${id}/raw`);expect(shot.searchParams.get('key')).toBeTruthy();
 const captured=await raw(request(shot.pathname+shot.search),params(id));expect(captured.status).toBe(200);expect(await captured.text()).toContain('Native content');
});


it('does not render or package retired JSX rows through a document door', async () => {
 const {actor,id}=await publish();
 await (await getDb()).query("UPDATE artifacts SET format = 'markup' WHERE id = $1", [id]);
 expect((await raw(request(`/a/${id}/raw`,{token:actor.token}),params(id))).status).toBe(404);
 expect((await download(request(`/a/${id}/download`,{token:actor.token}),params(id))).status).toBe(404);
 const answer=await artifactPageAnswer(request(`/a/${id}`,{actor:{credential:'session',userId:actor.userId!,email:actor.email??undefined}}),id,{pages:site});
 expect(answer.status).toBe(404);
});


it('admits only native public posts owned by the custom-domain account', () => {
 const post={user_id:'owner',visibility:'public' as const,format:'html' as const};
 expect(servesDocument('owner',post)).toBe(true);
 expect(servesDocument('stranger',post)).toBe(false);
 expect(servesDocument('owner',{...post,visibility:'private'})).toBe(false);
 expect(servesDocument('owner',{...post,deleted_at:new Date()})).toBe(false);
 expect(servesDocument('owner',{...post,format:'markup'})).toBe(false);
});


it('answers admitted native validators and HEAD without reading or assembling source',async()=>{
 const {actor,id}=await publish();
 const req=(method='GET',tag?:string,token=actor.token)=>markPagesRequest(request(`/a/${id}/raw`,{method,token,headers:tag?{'if-none-match':tag}:{}}),{id,self:`https://${id}.pages.example.test`,site});
 const first=await raw(req(),params(id));const tag=first.headers.get('etag')!;expect(tag).toBeTruthy();
 const assemble=vi.spyOn(nativeHtml,'nativeHtmlDocument');
 const fullRow=vi.spyOn(artifacts,'getArtifactById');
 try{
  expect((await raw(req('GET',tag),params(id))).status).toBe(304);
  const head=await rawHead(req('HEAD'),params(id));expect(head.status).toBe(200);expect(head.headers.get('etag')).toBe(tag);expect(await head.text()).toBe('');
  expect(assemble).not.toHaveBeenCalled();expect(fullRow).not.toHaveBeenCalled();
  const stranger=await mintAccountToken('conditional-stranger');
  expect((await raw(req('GET',tag,stranger.token),params(id))).status).toBe(404);
  expect(assemble).not.toHaveBeenCalled();expect(fullRow).not.toHaveBeenCalled();
 }finally{assemble.mockRestore();fullRow.mockRestore();}
 const runtime=vi.spyOn(nativeHtml,'nativeHtmlRuntimeIdentity').mockResolvedValue('next-runtime');
 try{const changed=await raw(req('GET',tag),params(id));expect(changed.status).toBe(200);expect(changed.headers.get('etag')).not.toBe(tag);}finally{runtime.mockRestore();}
 const before=await (await read(request(`/api/artifacts/${id}`,{token:actor.token}),params(id))).json();
 const edited=await PUT(request(`/api/artifacts/${id}`,{method:'PUT',token:actor.token,json:{html:before.html.replace('Native content','Changed native content'),expectedVersion:before.version,expectedState:before.state}}),params(id));expect(edited.status).toBe(200);
 const changed=await raw(req('GET',tag),params(id));expect(changed.status).toBe(200);expect(changed.headers.get('etag')).not.toBe(tag);expect(await changed.text()).toContain('Changed native content');

});

it('keeps agent instructions in the native start shell until the first content replacement',async()=>{
 const actor=await mintAccountToken('native-start');
 const {POST:start}=await import('@/app/api/start/route');
 const created=await start(request('/api/start',{method:'POST',token:actor.token}));expect(created.status).toBe(201);
 const {id}=await created.json();
 const view=()=>request(`/a/${id}`,{actor:{credential:'session',userId:actor.userId!,email:actor.email??undefined}});
 const first=await artifactPageAnswer(view(),id,{pages:site});
 expect(first.body).toMatchObject({surface:{format:'html',starter:true}});expect(first.frame).toBeUndefined();
 const head=await(await read(request(`/api/artifacts/${id}`,{token:actor.token}),params(id))).json();
 const saved=await PUT(request(`/api/artifacts/${id}`,{method:'PUT',token:actor.token,json:{html:source,expectedVersion:head.version,expectedState:head.state}}),params(id));expect(saved.status).toBe(200);
 const next=await artifactPageAnswer(view(),id,{pages:site});expect(next.body).toMatchObject({surface:{starter:false}});expect(next.frame).toBeDefined();
});

it('links the platform stylesheet at its one stable address before authored styles and serves it to the page origin (D3)',async()=>{
 const actor=await mintAccountToken('native-platform-sheet');
 const created=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html:source.replace('<title>Native plan</title>','<title>Native plan</title><meta name="artifactbin:design-system" content="redline">'),visibility:'private'}}));
 const id=(await created.json()).id as string;
 const plain=await publish();
 expect(await (await raw(request(`/a/${plain.id}/raw`,{token:plain.actor.token}),params(plain.id))).text()).not.toContain('platform-styles');
 const assets=await buildHtmlAssets();
 const response=await raw(request(`/a/${id}/raw`,{token:actor.token}),params(id));
 expect(response.headers.get('content-security-policy')).toContain(PLATFORM_STYLES_PATH);
 expect(response.headers.get('content-security-policy')).toMatch(/font-src [^;]*\/fonts\//);
 const doc=new JSDOM(await response.text()).window.document;
 expect(doc.querySelector('link[data-af="platform-styles"]')!.getAttribute('href')).toBe('/af/styles.css');
 // One stable address, no version or hash: revalidated by its strong content ETag, so a deploy shows on the next load.
 const sheet=await systemsSheet(request(PLATFORM_STYLES_PATH));
 expect(sheet.status).toBe(200);expect(sheet.headers.get('content-type')).toMatch(/^text\/css/);
 expect(sheet.headers.get('cache-control')).toBe('no-cache');expect(await sheet.text()).toBe(assets.systems);
 const tag=sheet.headers.get('etag')!;expect(tag).toMatch(/^"[a-f0-9]{64}"$/);
 const held=await systemsSheet(request(PLATFORM_STYLES_PATH,{headers:{'if-none-match':tag}}));expect(held.status).toBe(304);expect(await held.text()).toBe('');
 const head=await systemsHead(request(PLATFORM_STYLES_PATH,{method:'HEAD'}));expect(head.status).toBe(200);expect(head.headers.get('etag')).toBe(tag);expect(await head.text()).toBe('');
 expect((await systemsSheet(request(PLATFORM_STYLES_PATH,{headers:{'if-none-match':'"stale"'}}))).status).toBe(200);
});
it('publishing through the HTTP API stores the design system as head metadata (D2 on the server)',async()=>{
 const actor=await mintAccountToken('native-d2');
 const html='<!doctype html><html data-af-design-system="riso" data-af-dark="true"><head><title>D2</title><link data-af="design-system" rel="stylesheet" href="https://example.test/riso.css"></head><body><p>x</p></body></html>';
 const response=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html,visibility:'private'}}));
 expect(response.status,await response.clone().text()).toBe(201);
 const stored=(await artifacts.getArtifactById((await response.json()).id))!.source!;
 expect(stored).toContain('<meta name="artifactbin:design-system" content="riso"');
 expect(stored).not.toMatch(/data-af-dark|data-af-design-system=|data-af="design-system"/);
});

it('lets an owner pick the design system as page metadata: 13 systems or null, applied by the core and the reader (D4)',async()=>{
 const actor=await mintAccountToken('native-owner-theme');
 const html='<!doctype html><html><head><title>Owner</title><meta name="artifactbin:design-system" content="redline"></head><body><p>x</p></body></html>';
 const created=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html,visibility:'private'}}));
 const {id,state}=await created.json() as {id:string;state:string};
 const etag=async()=>(await raw(markPagesRequest(request(`/a/${id}/raw`,{token:actor.token}),{id,self:`https://${id}.pages.example.test`,site}),params(id))).headers.get('etag');
 const appearance=async()=>JSON.parse(new JSDOM(await (await raw(request(`/a/${id}/raw`,{token:actor.token}),params(id))).text()).window.document.querySelector('[data-af="runtime"]')!.textContent!).appearance;
 expect(await appearance()).toEqual({designSystem:'redline',mode:'light'});
 const story=await PATCH(request(`/api/artifacts/${id}`,{method:'PATCH',token:actor.token,json:{theme:'modernist',expectedState:state}}),params(id));
 expect(story.status).toBe(400);expect((await story.json()).allowed).toHaveLength(13);
 const picked=await PATCH(request(`/api/artifacts/${id}`,{method:'PATCH',token:actor.token,json:{theme:'nocturne',expectedState:state}}),params(id));
 expect(picked.status,await picked.clone().text()).toBe(200);
 const row=await artifacts.getArtifactById(id);expect(row!.version).toBe(1);expect(row!.source).toContain('content="redline"');
 expect(await appearance()).toEqual({designSystem:'nocturne',mode:'dark'});
 const answer=await artifactPageAnswer(request(`/a/${id}`,{actor:{credential:'session',userId:actor.userId!,email:actor.email??undefined}}),id,{pages:site});
 expect(answer.body).toMatchObject({surface:{theme:'nocturne',colorMode:'dark'}});
 const before=await etag();
 const cleared=await PATCH(request(`/api/artifacts/${id}`,{method:'PATCH',token:actor.token,json:{theme:null,expectedState:(await picked.json()).state}}),params(id));
 expect(cleared.status).toBe(200);expect(await appearance()).toEqual({designSystem:'redline',mode:'light'});
 expect(await etag()).not.toBe(before);
});
