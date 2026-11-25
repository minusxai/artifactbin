/** A published page's own files (`/a/<id>/assets?dependency=`): the reader's browser keeps pinned bytes, and one check stays cheap. */
import {beforeEach,expect,it} from 'vitest';
import {useAppHarness,request,testPagesSite} from '@/__tests__/harness';
import {setVisibility} from '@/__tests__/artifact-fixtures';
import {overrideConfig} from '@/lib/platform/config';
import {mintToken} from '@/lib/accounts';
import {createUser,setUsername} from '@/lib/accounts/testing';
import {mintExportKey} from '@/lib/export';
import {pagesOriginFor} from '@/lib/http';
import {measureQueries} from '@/lib/platform';
import {POST as publish} from '@/app/api/artifacts/route';
import {createAppServer} from '../app';
useAppHarness();
const IMMUTABLE='private, max-age=31536000, immutable';
const REVALIDATE='private, no-cache';
const base='https://alice.u.example.test';
const site=testPagesSite('pages.example.test','https://app.example.test');
const app=()=>createAppServer({indexHtml:async()=>'<html><body>APP</body></html>',pagesSite:site});
beforeEach(()=>overrideConfig({userPagesHost:'u.example.test',publicBaseUrl:'https://app.example.test'}));
const file=(path:string,source:string,contentType:string)=>({path,contentType,base64:Buffer.from(source).toString('base64')});

async function published(){
 const user=await createUser({email:`mxmx_test_assets_${Math.random()}@example.com`});const token=await mintToken('assets-test',user.id);await setUsername(user.id,'alice');
 const res=await publish(request('/api/artifacts',{method:'POST',token:token.token,headers:{'Idempotency-Key':`assets_${Math.random().toString(36).slice(2)}`},json:{visibility:'public',title:'Assets',
  html:'<link rel="stylesheet" href="./main.css"><img src="./logo.svg">',
  publicationBundle:{entryPath:'index.html',files:[file('main.css','body{background:url(./logo.svg)}','text/css'),file('logo.svg','<svg xmlns="http://www.w3.org/2000/svg"/>','image/svg+xml')]}}}));
 const saved=await res.json() as {id:string;version:number;dependencyReceipts:{path:string;id:string;revision:string}[]};expect(res.status,JSON.stringify(saved)).toBe(201);
 const receipt=(path:string)=>saved.dependencyReceipts.find(entry=>entry.path===path)!;
 const address=(path:string,pin=true)=>`/a/${saved.id}/assets?dependency=${receipt(path).id}&revision=${receipt(path).revision}${pin?`&version=${saved.version}`:''}`;
 return {saved,address,hosts:{publishing:base,app:pagesOriginFor(saved.id,site)}};
}

it('answers pinned bytes with the immutable rule on the publishing host and the app, and a 304 with the same rule',async()=>{
 const {address,hosts}=await published(),server=app();
 for(const [name,host] of Object.entries(hosts)){
  const pinned=await server.request(host+address('logo.svg'));expect(pinned.status,name).toBe(200);
  expect(pinned.headers.get('cache-control'),name).toBe(IMMUTABLE);const etag=pinned.headers.get('etag');expect(etag,name).toBeTruthy();
  expect(await pinned.text(),name).toContain('<svg');
  const held=await server.request(host+address('logo.svg'),{headers:{'if-none-match':etag!}});expect(held.status,name).toBe(304);
  expect(held.headers.get('cache-control'),name).toBe(IMMUTABLE);
  const unpinned=await server.request(host+address('logo.svg',false));expect(unpinned.status,name).toBe(200);expect(unpinned.headers.get('cache-control'),name).toBe(REVALIDATE);
  const stylesheet=await server.request(host+address('main.css'));expect(stylesheet.status,name).toBe(200);expect(stylesheet.headers.get('cache-control'),name).toBe(REVALIDATE);
  expect(await stylesheet.text(),name).toContain('/assets?dependency=');
  const tag=stylesheet.headers.get('etag')!;const revalidated=await server.request(host+address('main.css'),{headers:{'if-none-match':tag}});
  expect(revalidated.status,name).toBe(304);expect(revalidated.headers.get('cache-control'),name).toBe(REVALIDATE);
 }
});

it('never caches a capture-key answer',async()=>{
 const {saved,address,hosts}=await published(),server=app();
 const keyed=await server.request(hosts.app+address('logo.svg')+'&key='+encodeURIComponent(mintExportKey(saved.id)));
 expect(keyed.status).toBe(200);expect(keyed.headers.get('cache-control')).toBe('no-store');expect(keyed.headers.has('etag')).toBe(false);
});

it('stops serving the same address to a guest once the page turns private',async()=>{
 const {saved,address,hosts}=await published(),server=app();
 for(const host of Object.values(hosts))expect((await server.request(host+address('logo.svg'))).status).toBe(200);
 await setVisibility(saved.id,'private');
 for(const host of Object.values(hosts))expect((await server.request(host+address('logo.svg'))).status,host).toBe(404);
});

it('checks a pinned file within its query budget: the page row read once, on the publishing host and the app',async()=>{
 const {address,hosts}=await published(),server=app();
 // Publishing host: the site owner (handle, site root), the page row once, the file's own row. App: the page row, the file's.
 for(const [host,budget] of [[hosts.publishing,4],[hosts.app,2]] as const){
  expect((await server.request(host+address('logo.svg'))).status).toBe(200);
  const {value,stats}=await measureQueries(async()=>server.request(host+address('logo.svg')));
  expect(value.status,host).toBe(200);expect(stats.count,host).toBeLessThanOrEqual(budget);
 }
});
