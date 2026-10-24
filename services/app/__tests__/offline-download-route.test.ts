/** The retained download door emits native HTML with the original read policy. */
import {sha256Hex} from '@artifactbin/utils/sha256';
import {readPortableDocument} from '@/lib/html-runtime/portable';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, mintAccountToken } from '@/__tests__/harness';
import sharp from 'sharp';
import {getArtifactById} from '@/lib/artifacts';
import {getDb} from '@/lib/platform';
import { POST } from '@/app/api/artifacts/route';
import { GET as download } from '@/app/a/[id]/download/route';
useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const source = '<!doctype html><html><head><title>Trip plan</title><style>.status{color:rgb(20,90,40)}</style><script type="application/json" data-af="state">{"count":3,"label":"&lt;route&gt;"}</script><script src="/af/v1/core.js"></script><script type="module">import {client,gql} from "@afbin/apollo";</script></head><body><h1 class="status">Trip plan</h1><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg><img alt="Portable pixel" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></body></html>';
async function publish(visibility: 'private' | 'unlisted') {
  const actor = await mintAccountToken(`native-download-${visibility}`);
  const response = await POST(request('/api/artifacts', { method: 'POST', token: actor.token, json: { html: source, visibility } }));
  expect(response.status, await response.clone().text()).toBe(201);
  return { actor, id: (await response.json()).id as string };
}
describe('GET /a/<id>/download', () => {
  it('gives an authorized reader one native HTML attachment without account credentials', async () => {
    const { actor, id } = await publish('private');
    const response = await download(request(`/a/${id}/download`, { token: actor.token }), params(id));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="Trip plan.html"; filename*=UTF-8\'\'Trip%20plan.html');
    const html = await response.text();
    expect(html).not.toContain(actor.token);
    expect(html).not.toContain('afbin-file');
    expect(html).not.toContain('afbin-compiled-code');
    const doc = new JSDOM(html).window.document;
    const runtime = JSON.parse(doc.querySelector('[data-af="runtime"]')!.textContent!);
    expect(runtime).toMatchObject({ pageId: id, revision: '1', offline: true, initialState: { count: 3 } });
    expect(runtime.appOrigin).toBeUndefined();
    expect(doc.querySelectorAll('script[data-af="core"]')).toHaveLength(1);
    const portable=readPortableDocument(html);
    expect(portable.source).toBe((await getArtifactById(id))!.source);
    expect(portable.identity).toMatchObject({artifactId:id,baseRevision:'1',sourceDigest:sha256Hex(portable.source)});
    expect(new URL(portable.identity!.platformOrigin).origin).toBe(portable.identity!.platformOrigin);
    expect(doc.querySelector('script[src="/af/v1/core.js"]')).toBeNull();
  });
  it('lets anyone with an unlisted link download the native document', async () => {
    const { id } = await publish('unlisted');
    expect((await download(request(`/a/${id}/download`), params(id))).status).toBe(200);
  });
  it('keeps private and missing documents behind the same read refusal', async () => {
    const { id } = await publish('private');
    const stranger = await mintAccountToken('native-download-stranger');
    expect((await download(request(`/a/${id}/download`), params(id))).status).toBe(404);
    expect((await download(request(`/a/${id}/download`, { token: stranger.token }), params(id))).status).toBe(404);
    expect((await download(request('/a/Zz99Zz/download'), params('Zz99Zz'))).status).toBe(404);
  });
  it('preserves portable authored styles, media and viewer defaults as ordinary HTML', async () => {
    const { actor, id } = await publish('private');
    const response = await download(request(`/a/${id}/download`, { token: actor.token }), params(id));
    const doc = new JSDOM(await response.text()).window.document;
    expect(doc.querySelector('style')!.textContent).toContain('.status{color:rgb(20,90,40)}');
    expect(doc.querySelector('h1')!.getAttribute('class')).toBe('status');
    expect(doc.querySelector('svg circle')!.getAttribute('r')).toBe('4');
    expect(doc.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/gif;base64,/);
    expect(doc.querySelector('[data-af="state"]')!.textContent).toContain('"count":3');
  });
});

it('packs admitted private raster image bytes only for an authorized current reader',async()=>{
 const actor=await mintAccountToken('offline-image-owner');
 const bytes=await sharp({create:{width:48,height:32,channels:3,background:'#33cc33'}}).png().toBuffer();
 const image=await (await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{image:`data:image/png;base64,${bytes.toString('base64')}`,visibility:'private'}}))).json();
 const published=await POST(request('/api/artifacts',{method:'POST',token:actor.token,json:{html:`<!doctype html><html><head><title>Portable image</title></head><body><img data-af-id="picture" src="ref:${image.id}" alt="Saved picture"></body></html>`,visibility:'unlisted'}}));expect(published.status).toBe(201);const page=await published.json();
 const response=await download(request(`/a/${page.id}/download`,{token:actor.token}),params(page.id));expect(response.status).toBe(200);
 const html=await response.text(),doc=new JSDOM(html).window.document,imageNode=doc.querySelector('img')!;
 expect(imageNode.getAttribute('data-af-id')).toBe('picture');expect(imageNode.getAttribute('src')).toMatch(/^data:image\/webp;base64,/);expect(html).not.toContain(actor.token);expect(imageNode.getAttribute('src')).not.toContain('ref:');
 const packed=Buffer.from(imageNode.getAttribute('src')!.split(',')[1]!,'base64');expect(await sharp(packed).metadata()).toMatchObject({width:48,height:32});
 expect((await download(request(`/a/${page.id}/download`),params(page.id))).status).toBe(404);
 await (await getDb()).query("UPDATE artifacts SET deleted_at=now() WHERE id=$1",[image.id]);
 expect((await download(request(`/a/${page.id}/download`,{token:actor.token}),params(page.id))).status).toBe(404);
});
it('packs authorized bundle CSS and module bytes while retaining original canonical publication source',async()=>{
 const actor=await mintAccountToken('offline-bundle-owner');
 const file=(path:string,content:string,contentType:string)=>({path,contentType,base64:Buffer.from(content).toString('base64')});
 const response=await POST(request('/api/artifacts',{method:'POST',token:actor.token,headers:{'Idempotency-Key':'offline_bundle_export_01'},json:{html:'<html><head><link rel="stylesheet" href="./site.css"><script type="module" src="./app.js"></script></head><body><h1 data-af-id="heading">Bundle</h1></body></html>',publicationBundle:{entryPath:'index.html',files:[file('site.css','body{color:green}','text/css'),file('app.js','document.body.dataset.ready="yes"','text/javascript')]}}}));
 expect(response.status).toBe(201);const saved=await response.json();
 const downloaded=await download(request(`/a/${saved.id}/download`,{token:actor.token}),params(saved.id));expect(downloaded.status).toBe(200);
 const bytes=await downloaded.text(),doc=new JSDOM(bytes).window.document;
 expect(doc.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toMatch(/^data:text\/css;base64,/);
 expect(doc.querySelector('script[type="module"][src]')?.getAttribute('src')).toMatch(/^data:text\/javascript;base64,/);
 expect(readPortableDocument(bytes).source).toBe((await getArtifactById(saved.id))!.source);
 expect(bytes).not.toContain(actor.token);
 await (await getDb()).query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[saved.dependencyReceipts[0].id]);
 // A fresh export never embeds bytes from a dependency whose current ACL/readability was revoked.
 expect((await download(request(`/a/${saved.id}/download`,{token:actor.token}),params(saved.id))).status).toBe(404);
});
