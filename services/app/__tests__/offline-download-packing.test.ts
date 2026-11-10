/**
 * What an offline download packs (offline-download-route.test.ts has the door): admitted images, bundle CSS and modules,
 * DNS provenance, the active design system, and the live-cell library only when imported.
 */
import { readPortableDocument } from '@/lib/html-runtime/portable';
import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, mintAccountToken } from '@/__tests__/harness';
import sharp from 'sharp';
import { getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { POST } from '@/app/api/artifacts/route';
import { GET as download } from '@/app/a/[id]/download/route';
import { params, source, publish } from './offline-download-fixture';

useAppHarness();

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

it('preserves HTTP DNS provenance in offline downloads without granting connection authority',async()=>{
 const {actor,id}=await publish('unlisted');const input=request(`/a/${id}/download`,{token:actor.token});input.headers.set('x-forwarded-proto','http');input.headers.set('x-forwarded-host','app.lvh.me:53324');
 const response=await download(input,params(id));expect(response.status).toBe(200);expect(readPortableDocument(await response.text()).identity?.platformOrigin).toBe('http://app.lvh.me:53324');
});
  it('embeds only the active design system and its fonts, and tells the core the appearance (D3/D4)', async () => {
    const actor = await mintAccountToken('native-download-system');
    const html = source.replace('<title>Trip plan</title>', '<title>Trip plan</title><meta name="artifactbin:design-system" content="phosphor">');
    const created = await POST(request('/api/artifacts', { method: 'POST', token: actor.token, json: { html, visibility: 'private' } }));
    expect(created.status, await created.clone().text()).toBe(201);
    const id = (await created.json()).id as string;
    const doc = new JSDOM(await (await download(request(`/a/${id}/download`, { token: actor.token }), params(id))).text()).window.document;
    const style = doc.querySelector('style[data-af="platform-styles"]')!.textContent!;
    expect(style).toMatch(/\[data-af-design-system="?phosphor"?\]/);
    expect(style).not.toMatch(/\[data-af-design-system="?redline"?\]/);
    expect(style).toContain('data:font/woff2;base64,');
    expect(style).not.toContain('/fonts/');
    expect(doc.querySelector('link[data-af="platform-styles"]')).toBeNull();
    expect(JSON.parse(doc.querySelector('[data-af="runtime"]')!.textContent!).appearance).toEqual({ designSystem: 'phosphor', mode: 'dark' });
  });
it('carries the live-cell library in a download of a page that imports it, and only then', async () => {
  const actor = await mintAccountToken('native-download-collab');
  const cells = '<!doctype html><html><head><title>Cells</title></head><body><textarea id="d">Saved value</textarea><script type="module">import {collab} from "@afbin/collab";collab.text("tasks","r_abc","description").bind(document.getElementById("d"));</script></body></html>';
  const created = await POST(request('/api/artifacts', { method: 'POST', token: actor.token, json: { html: cells, visibility: 'private' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const response = await download(request(`/a/${id}/download`, { token: actor.token }), params(id));
  expect(response.status, await response.clone().text()).toBe(200);
  const html = await response.text();
  const doc = new JSDOM(html).window.document;
  // The module rides as an inert JSON block the core maps to a blob URL (no network); the page still imports it by name.
  const block = doc.querySelector('script[type="application/json"][data-af="collab"]');
  expect(block).not.toBeNull();
  expect(JSON.parse(block!.textContent!)).toContain('@afbin/reader');
  expect(doc.querySelector('script[data-af="core"]')!.textContent).toContain('[data-af="collab"]');
  expect([...doc.querySelectorAll('script[type="module"]')].map((script) => script.textContent).join('')).toMatch(/from\s*["']@afbin\/collab["']/);
  // The canonical source travels without it; a page that does not import the library carries none.
  expect(readPortableDocument(html).source).not.toContain('data-af="collab"');
  const { actor: other, id: plain } = await publish('private');
  const without = new JSDOM(await (await download(request(`/a/${plain}/download`, { token: other.token }), params(plain))).text()).window.document;
  expect(without.querySelector('[data-af="collab"]')).toBeNull();
  // Every copy carries @afbin/state (the embedded @afbin/apollo imports it), and its source never does.
  for (const copy of [doc, without]) expect(JSON.parse(copy.querySelector('script[type="application/json"][data-af="state-module"]')!.textContent!)).toContain('af:viewer:');
  expect(readPortableDocument(html).source).not.toContain('data-af="state-module"');
});
