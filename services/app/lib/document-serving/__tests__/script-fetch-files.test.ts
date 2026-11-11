/**
 * A page script's plain `fetch('./data.json')` of a file published with the page: publish finds the literal path and
 * uploads the file, and every surface the page is read from tells its core (html-runtime/page-fetch) where that path
 * now lives — the page's own asset door, which answers exactly whoever may read the page. Only paths the page's own
 * publication recorded are in the table.
 */
import {describe,expect,it} from 'vitest';
import {JSDOM} from 'jsdom';
import {mintAccountToken,request,testIdentity,testPagesSite,useAppHarness} from '@/__tests__/harness';
import {POST} from '@/app/api/artifacts/route';
import {GET as assetGet} from '@/app/a/[id]/assets/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as download} from '@/app/a/[id]/download/route';

useAppHarness();
const file=(path:string,source:string,contentType:string)=>({path,contentType,base64:Buffer.from(source).toString('base64')});
const DATA='{"total":42}';
const SCRIPT='<script type="module">const data=await (await fetch(\'./data.json\')).json();document.querySelector(\'#total\').textContent=String(data.total);</script>';
const PAGE=`<!doctype html><html><head><title>Totals</title></head><body><p id="total">…</p>${SCRIPT}</body></html>`;
const params=(id:string)=>({params:Promise.resolve({id})});
const runtimeOf=(html:string)=>JSON.parse(new JSDOM(html).window.document.querySelector('[data-af="runtime"]')!.textContent!) as {files?:Record<string,string>};
const ASSET=(page:string,dependency:string)=>`/a/${page}/assets?dependency=${dependency}&revision=1&version=1`;

async function published(visibility:'unlisted'|'private',name:string,entryPath='index.html',files=[file(entryPath.replace(/[^/]*$/,'')+'data.json',DATA,'application/json')]){
 const {createUser,issuePagesTicket}=await import('@/lib/accounts');
 const {setServices}=await import('@/lib/platform');
 const {pagesOriginFor}=await import('@/lib/http');
 const {createAppServer}=await import('@/server/app');
 const user=await createUser({email:`mxmx_test_${name}@example.com`});const owner=await mintAccountToken(name,user.id);
 const response=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':`script_fetch_${name}_0001`},json:{visibility,html:PAGE,publicationBundle:{entryPath,files}}}));
 const saved=await response.json() as {id:string;dependencyReceipts:{path:string;id:string}[]};
 expect(response.status,JSON.stringify(saved)).toBe(201);
 const site=testPagesSite('pages.example.test','https://app.example.test'),self=pagesOriginFor(saved.id,site);
 const app=createAppServer({indexHtml:async()=>'<html><body><div id="root"></div></body></html>',pagesSite:site});
 setServices({humanSessions:{live:async(id,userId)=>id===`fetch-${user.id}`&&userId===user.id}});
 const ticket=await issuePagesTicket({...testIdentity('session',{userId:user.id,email:user.email}),sessionId:`fetch-${user.id}`},{},Date.now(),{artifactId:saved.id,origin:self});
 const opened=await app.request(self+'/?_pt='+ticket);expect(opened.status).toBe(200);
 const cookie='__Host-afbin_pages='+/__Host-afbin_pages=([^;]+)/.exec(opened.headers.get('set-cookie')??'')![1];
 return {app,self,owner,saved,cookie,served:await opened.text()};
}

describe('a file a page script fetches by its path',()=>{
 it('publishes with the page and is mapped to its asset door: owner and signed-out reader of an unlisted page, on its own origin, /raw and an owner host',async()=>{
  const {app,self,owner,saved,cookie,served}=await published('unlisted','fetch_unlisted');
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

 it('answers the owner and nobody signed out on a private page',async()=>{
  const {app,self,owner,saved,cookie,served}=await published('private','fetch_private');
  const address=runtimeOf(served).files!['data.json']!;
  expect(address).toBe(ASSET(saved.id,saved.dependencyReceipts[0]!.id));
  expect((await app.request(self+address)).status).toBe(404);
  const read=await app.request(self+address,{headers:{cookie}});expect(read.status).toBe(200);expect(await read.json()).toEqual({total:42});
  expect((await assetGet(request(address),params(saved.id))).status).toBe(404);
  expect((await assetGet(request(address,{token:owner.token}),params(saved.id))).status).toBe(200);
  const stranger=await mintAccountToken('fetch_private_stranger');
  expect((await assetGet(request(address,{token:stranger.token}),params(saved.id))).status).toBe(404);
  expect((await raw(request(`/a/${saved.id}/raw`),params(saved.id))).status).toBe(404);
 });

 it('maps the path as the page reads it when the page sits in a folder of its project',async()=>{
  const {saved,served}=await published('unlisted','fetch_folder','site/index.html');
  expect(saved.dependencyReceipts.map(receipt=>receipt.path)).toEqual(['site/data.json']);
  expect(runtimeOf(served).files).toEqual({'data.json':ASSET(saved.id,saved.dependencyReceipts[0]!.id)});
 });

 it('carries the file in an exported copy, where the same fetch reads its bytes',async()=>{
  const {owner,saved}=await published('private','fetch_export');
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
  const bare=await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:PAGE,visibility:'unlisted'}}));
  expect(bare.status).toBe(201);const {id}=await bare.json() as {id:string};
  expect(runtimeOf(await (await raw(request(`/a/${id}/raw`),params(id))).text()).files).toBeUndefined();
  // A file the page neither links nor fetches by a literal path is refused, saying what to write.
  const unread=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'script_fetch_unread_0001'},json:{html:PAGE,publicationBundle:{entryPath:'index.html',files:[file('data.json',DATA,'application/json'),file('notes.json','{}','application/json')]}}}));
  expect(unread.status).toBe(400);
  const details=(await unread.json() as {details:string[]}).details.join(' ');
  expect(details).toContain('notes.json');expect(details).toContain("fetch('./notes.json')");expect(details).not.toContain('data.json');
 });
});

describe('a platform boundary file a page fetches by its path',()=>{
 it('is the same line on the page\'s own origin for a signed-out reader of an unlisted page, and carried in an exported copy',async()=>{
  const {readFileSync}=await import('node:fs');const path=await import('node:path');
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
