/**
 * Files a page links and reads, published with it: an `<a href>` and a declared `<link rel="preload" as="fetch">`
 * point at the page's own asset door, as do literal script fetches through the runtime file table. Test the door
 * on the document's own origin and on the app's, and the runtime table on raw, owner-host and exported pages.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {JSDOM} from 'jsdom';
import { mintAccountToken, request, testPagesSite, useAppHarness, params } from '@/__tests__/harness';
import {POST} from '@/app/api/artifacts/route';
import {publishBundleAndOpen} from './bundle-fixture';
import {GET as assetGet,HEAD as assetHead} from '@/app/a/[id]/assets/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as download} from '@/app/a/[id]/download/route';

useAppHarness();
const file=(path:string,source:string,contentType:string)=>({path,contentType,base64:Buffer.from(source).toString('base64')});
const PDF='%PDF-1.4\n% rota\n%%EOF\n';
const LINK_PAGE='<!doctype html><html><head><link rel="preload" as="fetch" href="./data.json" crossorigin><link rel="preload" as="fetch" href="./map.geojson" crossorigin></head><body><a id="rota" href="./rota.pdf">Rota</a></body></html>';
const FILES=[file('rota.pdf',PDF,'application/octet-stream'),file('data.json','{"rows":[1,2,3]}','application/json'),file('map.geojson','{"type":"FeatureCollection","features":[]}','application/octet-stream')];


/** The address the served document gives the element `tag` that links the file `path`, as the browser resolves it. */
function addressOf(html:string,tag:string,saved:{dependencyReceipts:{path:string;id:string}[]},path:string):string{
 const id=saved.dependencyReceipts.find(receipt=>receipt.path===path)!.id;
 const href=new RegExp(`<${tag} [^>]*href="(/a/[A-Za-z0-9]+/assets\\?dependency=${id}&amp;[^"]*)"`).exec(html)?.[1];
 expect(href,html.match(/<(?:a|link) [^>]*>/g)?.join('\n')).toBeTruthy();
 return href!.replaceAll('&amp;','&');
}
const ASSET_PATTERN=/^\/a\/[A-Za-z0-9]+\/assets\?dependency=[A-Za-z0-9]+&revision=1&version=1$/;
const appRead=(address:string,id:string,token?:string)=>assetGet(request(address,token?{token}:{}),params(id));

const DATA='{"total":42}';
const SCRIPT='<script type="module">const data=await (await fetch(\'./data.json\')).json();document.querySelector(\'#total\').textContent=String(data.total);</script>';
const FETCH_PAGE=`<!doctype html><html><head><title>Totals</title></head><body><p id="total">…</p>${SCRIPT}</body></html>`;
const runtimeOf=(html:string)=>JSON.parse(new JSDOM(html).window.document.querySelector('[data-af="runtime"]')!.textContent!) as {files?:Record<string,string>};
const ASSET=(page:string,dependency:string)=>`/a/${page}/assets?dependency=${dependency}&revision=1&version=1`;

async function publishedFetch(visibility:'unlisted'|'private',name:string,entryPath='index.html',files=[file(entryPath.replace(/[^/]*$/,'')+'data.json',DATA,'application/json')]){
 return publishBundleAndOpen('script_fetch','fetch',visibility,name,FETCH_PAGE,{entryPath,files});
}

describe('a file published beside its page',()=>{
 it('is reached by its link and by a declared fetch: owner and signed-out reader of an unlisted page',async()=>{
  const {app,self,owner,saved,cookie,served}=await publishBundleAndOpen('bundle_links','links','unlisted','links_unlisted',LINK_PAGE,{
   entryPath:'index.html',files:FILES,
  });
  expect(saved.dependencyReceipts.map(receipt=>receipt.path).sort()).toEqual(['data.json','map.geojson','rota.pdf']);
  const link=addressOf(served,'a id="rota"',saved,'rota.pdf'),data=addressOf(served,'link rel="preload" as="fetch"',saved,'data.json');
  expect(link).toMatch(ASSET_PATTERN);expect(data).toMatch(ASSET_PATTERN);
  for(const headers of [{},{cookie}] as Record<string,string>[]){
   // The script's fetch, on the document's own origin (connect-src 'self').
   const read=await app.request(self+data,{headers});expect(read.status).toBe(200);expect(await read.json()).toEqual({rows:[1,2,3]});
   const pdf=await app.request(self+link,{headers});expect(pdf.status).toBe(200);
   expect(pdf.headers.get('content-type')).toBe('application/pdf');expect(pdf.headers.get('content-disposition')).toContain('inline; filename="rota.pdf"');
   expect(await pdf.text()).toBe(PDF);
  }
  // A reader's click on the link is followed by the app page (frame-links): the app's own door, signed out or in.
  for(const token of [undefined,owner.token]){const clicked=await appRead(link,saved.id,token);expect(clicked.status).toBe(200);expect(await clicked.text()).toBe(PDF);}
  const map=saved.dependencyReceipts.find(receipt=>receipt.path==='map.geojson')!;
  const geo=await app.request(self+`/a/${saved.id}/assets?dependency=${map.id}&revision=1`);
  expect(geo.status).toBe(200);expect(geo.headers.get('content-type')).toBe('application/geo+json');
  // Link access reads; it writes nothing through the door.
  for(const method of ['POST','PUT','DELETE'])expect((await app.request(self+link,{method})).status).toBe(404);
 });

 it('serves PDF HEAD and byte ranges while keeping mislabeled and other files as downloads',async()=>{
  const html='<a href="./rota.pdf">Rota</a><a href="./fake.pdf">Fake</a><a href="./data.json">Data</a>';
  const {app,self,saved}=await publishBundleAndOpen('bundle_links','links','unlisted','links_ranges',html,{
   entryPath:'index.html',files:[...FILES.slice(0,2),file('fake.pdf','<h1>HTML</h1>','application/pdf')],
  });
  const address=(path:string)=>self+`/a/${saved.id}/assets?dependency=${saved.dependencyReceipts.find(receipt=>receipt.path===path)!.id}&revision=1`;
  const head=await app.request(address('rota.pdf'),{method:'HEAD'});
  expect(head.status).toBe(200);
  expect(head.headers.get('content-disposition')).toContain('inline; filename="rota.pdf"');
  expect(head.headers.get('accept-ranges')).toBe('bytes');
  expect(head.headers.get('content-length')).toBe(String(PDF.length));
  expect(await head.text()).toBe('');
  const range=await app.request(address('rota.pdf'),{headers:{range:'bytes=0-4'}});
  expect(range.status).toBe(206);
  expect(range.headers.get('content-range')).toBe(`bytes 0-4/${PDF.length}`);
  expect(range.headers.get('content-security-policy')).toBe('sandbox');
  expect(range.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await range.text()).toBe('%PDF-');
  expect((await app.request(address('rota.pdf'),{headers:{range:'bytes=999-'}})).status).toBe(416);
  for(const path of ['fake.pdf','data.json']){
   const response=await app.request(address(path));
   expect(response.status).toBe(200);
   expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
   await response.text();
  }
 });

 it('admits only the owner to files linked or fetched by a private page',async()=>{
  const html=LINK_PAGE.replace('</body>',`<p id="total">…</p>${SCRIPT}</body>`);
  const files=FILES.map(entry=>entry.path==='data.json'?file('data.json',DATA,'application/json'):entry);
  const {app,self,owner,saved,cookie,served}=await publishBundleAndOpen('bundle_links','links','private','links_private',html,{
   entryPath:'index.html',files,
  });
  const link=addressOf(served,'a id="rota"',saved,'rota.pdf');
  const preload=addressOf(served,'link rel="preload" as="fetch"',saved,'data.json');
  const data=runtimeOf(served).files?.['data.json'];
  const receipt=saved.dependencyReceipts.find(entry=>entry.path==='data.json')!;
  expect(data).toBe(ASSET(saved.id,receipt.id));
  expect(preload).toBe(data);

  const stranger=await mintAccountToken('links_private_stranger');
  for(const {address,bytes} of [{address:link,bytes:PDF},{address:preload,bytes:DATA}]){
   expect((await app.request(self+address)).status,address).toBe(404);
   const read=await app.request(self+address,{headers:{cookie}});
   expect(read.status,address).toBe(200);
   expect(await read.text()).toBe(bytes);
   expect((await appRead(address,saved.id)).status,address).toBe(404);
   expect((await assetHead(request(address,{method:'HEAD'}),params(saved.id))).status,address).toBe(404);
   expect((await appRead(address,saved.id,owner.token)).status,address).toBe(200);
   expect((await appRead(address,saved.id,stranger.token)).status,address).toBe(404);
  }

  expect((await raw(request(`/a/${saved.id}/raw`),params(saved.id))).status).toBe(404);
 });
});

describe('what publish refuses or keeps',()=>{
 it('keeps a relative link as written in a save that carries no project, and names a linked page it cannot publish',async()=>{
  const owner=await mintAccountToken('links_refusals');
  const bare=await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<a href="./notes.pdf">Notes</a>'}}));
  expect(bare.status).toBe(201);
  const page=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'bundle_links_page_0001'},json:{html:'<a href="./other.html">Other</a>',publicationBundle:{entryPath:'index.html',files:[file('other.html','<h1>Other</h1>','text/html')]}}}));
  expect(page.status).toBe(409);
  expect((await page.json() as {details:string[]}).details.join(' ')).toContain('other.html is a page: publish it on its own and link its address');
  const unlinked=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'bundle_links_unlinked_01'},json:{html:'<h1>x</h1>',publicationBundle:{entryPath:'index.html',files:[file('data.json','{}','application/json')]}}}));
  expect(unlinked.status).toBe(400);
  expect((await unlinked.json() as {details:string[]}).details.join(' ')).toContain("fetch('./data.json')");
 });
});

describe('a file a page script fetches by its path',()=>{
 it('publishes with the page and is mapped to its asset door: owner and signed-out reader of an unlisted page, on its own origin, /raw and an owner host',async()=>{
  const {app,self,owner,saved,cookie,served}=await publishedFetch('unlisted','fetch_unlisted');
  expect(saved.dependencyReceipts.map(receipt=>receipt.path)).toEqual(['data.json']);
  const address=ASSET(saved.id,saved.dependencyReceipts[0]!.id);
  // The page's source keeps the path its author wrote; only the runtime table names the door.
  expect(served).toContain("fetch('./data.json')");
  expect(runtimeOf(served).files).toEqual({'data.json':address});
  for(const headers of [{},{cookie}] as Record<string,string>[]){
   const read=await app.request(self+address,{headers});expect(read.status).toBe(200);expect(await read.json()).toEqual({total:42});
  }
  // /raw on the app's origin: the same table, the address resolved against the app.
  for(const token of [undefined,owner.token]){
   const rawPage=await raw(request(`/a/${saved.id}/raw`,token?{token}:{}),params(saved.id));expect(rawPage.status).toBe(200);
   expect(runtimeOf(await rawPage.text()).files).toEqual({'data.json':address});
   const read=await assetGet(request(address,token?{token}:{}),params(saved.id));expect(read.status).toBe(200);expect(await read.json()).toEqual({total:42});
  }
  // An owner host renders the same document with domain reads; the table is the same.
  const {nativeHtmlDocument}=await import('@/lib/document-serving');const {getArtifactById}=await import('@/lib/artifacts');
  const row=(await getArtifactById(saved.id))!;
  expect((await nativeHtmlDocument({row,domainReads:true})).config.files).toEqual({'data.json':address});
 });

 it('maps the path as the page reads it when the page sits in a folder of its project',async()=>{
  const {saved,served}=await publishedFetch('unlisted','fetch_folder','site/index.html');
  expect(saved.dependencyReceipts.map(receipt=>receipt.path)).toEqual(['site/data.json']);
  expect(runtimeOf(served).files).toEqual({'data.json':ASSET(saved.id,saved.dependencyReceipts[0]!.id)});
 });

 it('carries the file in an exported copy, where the same fetch reads its bytes',async()=>{
  const {owner,saved}=await publishedFetch('private','fetch_export');
  const copy=await download(request(`/a/${saved.id}/download`,{token:owner.token}),params(saved.id));expect(copy.status).toBe(200);
  const files=runtimeOf(await copy.text()).files!;
  expect(Object.keys(files)).toEqual(['data.json']);
  expect(files['data.json']!.startsWith('data:application/json;base64,')).toBe(true);
  expect(Buffer.from(files['data.json']!.split(',')[1]!,'base64').toString()).toBe(DATA);
 });
});

describe('what the table leaves alone',()=>{
 it('names no path the publication did not record, and a page that published no file has no table',async()=>{
  const owner=await mintAccountToken('fetch_none');
  const bare=await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:FETCH_PAGE,visibility:'unlisted'}}));
  expect(bare.status).toBe(201);const {id}=await bare.json() as {id:string};
  expect(runtimeOf(await (await raw(request(`/a/${id}/raw`),params(id))).text()).files).toBeUndefined();
  // A file the page neither links nor fetches by a literal path is refused, saying what to write.
  const unread=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'script_fetch_unread_0001'},json:{html:FETCH_PAGE,publicationBundle:{entryPath:'index.html',files:[file('data.json',DATA,'application/json'),file('notes.json','{}','application/json')]}}}));
  expect(unread.status).toBe(400);
  const details=(await unread.json() as {details:string[]}).details.join(' ');
  expect(details).toContain('notes.json');expect(details).toContain("fetch('./notes.json')");expect(details).not.toContain('data.json');
 });
});

describe('a platform boundary file a page fetches by its path',()=>{
 it('is the same line on the page\'s own origin for a signed-out reader of an unlisted page, and carried in an exported copy',async()=>{
  const {pagesOriginFor}=await import('@/lib/http');const {createAppServer}=await import('@/server/app');
  const geo=readFileSync(path.resolve('public/geojson/india-states.json'));
  const html='<!doctype html><html><head><title>States</title></head><body><script type="module">const states=await (await fetch("/af/geojson/india-states.json")).json();document.body.dataset.states=String(states.features.length);</script></body></html>';
  const owner=await mintAccountToken('boundary_unlisted');
  const created=await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html,visibility:'unlisted'}}));
  expect(created.status).toBe(201);const {id}=await created.json() as {id:string};
  const site=testPagesSite('pages.example.test','https://app.example.test'),self=pagesOriginFor(id,site);
  const app=createAppServer({indexHtml:async()=>'<html><body><div id="root"></div></body></html>',pagesSite:site});
  const page=await app.request(self+'/');expect(page.status).toBe(200);
  expect(await page.text()).toContain('fetch("/af/geojson/india-states.json")');
  expect(page.headers.get('content-security-policy')).toMatch(/connect-src 'self'/);
  const read=await app.request(self+'/af/geojson/india-states.json');expect(read.status).toBe(200);
  expect(read.headers.get('content-type')).toMatch(/^application\/json/);
  expect(Buffer.from(await read.arrayBuffer())).toEqual(geo);
  // A download has no origin to fetch from: it carries the file under the same path.
  const copy=await download(request(`/a/${id}/download`,{token:owner.token}),params(id));expect(copy.status).toBe(200);
  const files=runtimeOf(await copy.text()).files!;
  expect(Object.keys(files)).toEqual(['/af/geojson/india-states.json']);
  expect(Buffer.from(files['/af/geojson/india-states.json']!.replace('data:application/json;base64,',''),'base64')).toEqual(geo);
 });
});
