/**
 * Files a page links and reads, published with it: an `<a href>` and a declared `<link rel="preload" as="fetch">`
 * point at the page's own asset door, which answers exactly whoever may read the page, on the document's own origin
 * (where its script runs) and on the app's (where a reader's click on a link lands).
 */
import {describe,expect,it} from 'vitest';
import {mintAccountToken,request,testIdentity,testPagesSite,useAppHarness} from '@/__tests__/harness';
import {POST} from '@/app/api/artifacts/route';
import {GET as assetGet,HEAD as assetHead} from '@/app/a/[id]/assets/route';

useAppHarness();
const file=(path:string,source:string,contentType:string)=>({path,contentType,base64:Buffer.from(source).toString('base64')});
const PDF='%PDF-1.4\n% rota\n%%EOF\n';
const PAGE='<!doctype html><html><head><link rel="preload" as="fetch" href="./data.json" crossorigin><link rel="preload" as="fetch" href="./map.geojson" crossorigin></head><body><a id="rota" href="./rota.pdf">Rota</a></body></html>';
const FILES=[file('rota.pdf',PDF,'application/octet-stream'),file('data.json','{"rows":[1,2,3]}','application/json'),file('map.geojson','{"type":"FeatureCollection","features":[]}','application/octet-stream')];

async function published(visibility:'unlisted'|'private',name:string){
 const {createUser,issuePagesTicket}=await import('@/lib/accounts');
 const {setServices}=await import('@/lib/platform');
 const {pagesOriginFor}=await import('@/lib/http');
 const {createAppServer}=await import('@/server/app');
 const user=await createUser({email:`mxmx_test_${name}@example.com`});const owner=await mintAccountToken(name,user.id);
 const response=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':`bundle_links_${name}_0001`},json:{visibility,html:PAGE,publicationBundle:{entryPath:'index.html',files:FILES}}}));
 const saved=await response.json() as {id:string;dependencyReceipts:{path:string;id:string}[]};
 expect(response.status,JSON.stringify(saved)).toBe(201);
 const site=testPagesSite('pages.example.test','https://app.example.test'),self=pagesOriginFor(saved.id,site);
 const app=createAppServer({indexHtml:async()=>'<html><body><div id="root"></div></body></html>',pagesSite:site});
 setServices({humanSessions:{live:async(id,userId)=>id===`links-${user.id}`&&userId===user.id}});
 const ticket=await issuePagesTicket({...testIdentity('session',{userId:user.id,email:user.email}),sessionId:`links-${user.id}`},{},Date.now(),{artifactId:saved.id,origin:self});
 const opened=await app.request(self+'/?_pt='+ticket);expect(opened.status).toBe(200);
 const cookie='__Host-afbin_pages='+/__Host-afbin_pages=([^;]+)/.exec(opened.headers.get('set-cookie')??'')![1];
 return {app,self,owner,saved,cookie,served:await opened.text()};
}
/** The address the served document gives the element `tag` that links the file `path`, as the browser resolves it. */
function addressOf(html:string,tag:string,saved:{dependencyReceipts:{path:string;id:string}[]},path:string):string{
 const id=saved.dependencyReceipts.find(receipt=>receipt.path===path)!.id;
 const href=new RegExp(`<${tag} [^>]*href="(/a/[A-Za-z0-9]+/assets\\?dependency=${id}&amp;[^"]*)"`).exec(html)?.[1];
 expect(href,html.match(/<(?:a|link) [^>]*>/g)?.join('\n')).toBeTruthy();
 return href!.replaceAll('&amp;','&');
}
const ASSET=/^\/a\/[A-Za-z0-9]+\/assets\?dependency=[A-Za-z0-9]+&revision=1&version=1$/;
const appRead=(path:string,token?:string)=>{const id=path.split('/')[2]!;return assetGet(request(path,token?{token}:{}),{params:Promise.resolve({id})});};

describe('a file published beside its page',()=>{
 it('is reached by its link and by a declared fetch: owner and signed-out reader of an unlisted page',async()=>{
  const {app,self,owner,saved,cookie,served}=await published('unlisted','links_unlisted');
  expect(saved.dependencyReceipts.map(receipt=>receipt.path).sort()).toEqual(['data.json','map.geojson','rota.pdf']);
  const link=addressOf(served,'a id="rota"',saved,'rota.pdf'),data=addressOf(served,'link rel="preload" as="fetch"',saved,'data.json');
  expect(link).toMatch(ASSET);expect(data).toMatch(ASSET);
  for(const headers of [{},{cookie}] as Record<string,string>[]){
   // The script's fetch, on the document's own origin (connect-src 'self').
   const read=await app.request(self+data,{headers});expect(read.status).toBe(200);expect(await read.json()).toEqual({rows:[1,2,3]});
   const download=await app.request(self+link,{headers});expect(download.status).toBe(200);
   expect(download.headers.get('content-type')).toBe('application/pdf');expect(download.headers.get('content-disposition')).toContain('attachment; filename="rota.pdf"');
   expect(await download.text()).toBe(PDF);
  }
  // A reader's click on the link is followed by the app page (frame-links): the app's own door, signed out or in.
  for(const token of [undefined,owner.token]){const clicked=await appRead(link,token);expect(clicked.status).toBe(200);expect(await clicked.text()).toBe(PDF);}
  const map=saved.dependencyReceipts.find(receipt=>receipt.path==='map.geojson')!;
  const geo=await app.request(self+`/a/${saved.id}/assets?dependency=${map.id}&revision=1`);
  expect(geo.status).toBe(200);expect(geo.headers.get('content-type')).toBe('application/geo+json');
  // Link access reads; it writes nothing through the door.
  for(const method of ['POST','PUT','DELETE'])expect((await app.request(self+link,{method})).status).toBe(404);
 });

 it('answers the owner and nobody signed out on a private page',async()=>{
  const {app,self,owner,saved,cookie,served}=await published('private','links_private');
  const link=addressOf(served,'a id="rota"',saved,'rota.pdf'),data=addressOf(served,'link rel="preload" as="fetch"',saved,'data.json');
  for(const address of [link,data]){
   expect((await app.request(self+address)).status).toBe(404);
   expect((await app.request(self+address,{headers:{cookie}})).status).toBe(200);
   expect((await appRead(address)).status).toBe(404);
   expect((await assetHead(request(address),{params:Promise.resolve({id:address.split('/')[2]!})})).status).toBe(404);
   expect((await appRead(address,owner.token)).status).toBe(200);
  }
  const stranger=await mintAccountToken('links_private_stranger');
  expect((await appRead(link,stranger.token)).status).toBe(404);
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
