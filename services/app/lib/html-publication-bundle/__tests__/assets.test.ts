/** Bundle asset delivery: a page's admitted files, served and exported under the page's current read access. */
import {describe,expect,it} from 'vitest';
import {mintAccountToken,useAppHarness} from '@/__tests__/harness';
import {ANONYMOUS_ACTOR,identityForUser} from '@/lib/accounts';
import {createArtifactFromBody} from '@/lib/publish';
import {loadBundleAssetResources,serveBundleAsset} from '../index';

useAppHarness();
const BASE='http://localhost:3030';
const file=(path:string,text:string,contentType:string)=>({path,contentType,base64:Buffer.from(text).toString('base64')});
interface Receipt {path:string;id:string;revision:string}

async function bundledPage(visibility:'private'|'public'='private'){
 const token=await mintAccountToken('bundle_assets_owner');
 const owner=identityForUser(token.userId,token.id);
 const response=await createArtifactFromBody({visibility,html:'<link rel="stylesheet" href="./main.css"><img src="./logo.svg">',publicationBundle:{entryPath:'index.html',files:[file('main.css','body{background:url(./logo.svg)}','text/css'),file('logo.svg','<svg>☕</svg>','image/svg+xml')]}},owner,BASE,new Request(`${BASE}/api/artifacts`,{method:'POST',headers:{'Idempotency-Key':'bundle_assets_test_0001'}}));
 const saved=await response.json() as {id:string;dependencyReceipts:Receipt[]};
 expect(response.status,JSON.stringify(saved)).toBe(201);
 const receipt=(path:string)=>saved.dependencyReceipts.find(entry=>entry.path===path)!;
 return {owner,id:saved.id,logo:receipt('logo.svg'),css:receipt('main.css')};
}
const asset=(page:string,dependency:string,query='&revision=1')=>new Request(`${BASE}/a/${page}/assets?dependency=${dependency}${query}`);

describe('serveBundleAsset',()=>{
 it('serves an admitted file to a reader, and pins nested URLs to the page version when asked',async()=>{
  const {owner,id,logo,css}=await bundledPage();
  const svg=await serveBundleAsset(asset(id,logo.id),owner,id,logo.id);
  expect(svg?.status).toBe(200);
  expect(await svg!.text()).toBe('<svg>☕</svg>');
  const pinned=await serveBundleAsset(asset(id,css.id,'&revision=1&version=1'),owner,id,css.id);
  expect(await pinned!.text()).toContain(`/a/${id}/assets?dependency=${logo.id}&revision=1&version=1`);
  const head=await serveBundleAsset(new Request(`${BASE}/a/${id}/assets?dependency=${css.id}&revision=1&version=1`,{method:'HEAD'}),owner,id,css.id);
  expect(head?.status).toBe(200);
  expect(await head!.text()).toBe('');
 });

 it('answers nothing to a reader who cannot read the page, for another revision, an unknown file or a non-page',async()=>{
  const {owner,id,logo}=await bundledPage();
  const stranger=await mintAccountToken('bundle_assets_stranger');
  expect(await serveBundleAsset(asset(id,logo.id),identityForUser(stranger.userId,stranger.id),id,logo.id)).toBeNull();
  expect(await serveBundleAsset(asset(id,logo.id),ANONYMOUS_ACTOR,id,logo.id)).toBeNull();
  expect(await serveBundleAsset(asset(id,logo.id,'&revision=9'),owner,id,logo.id)).toBeNull();
  expect(await serveBundleAsset(asset(id,'Unknown123'),owner,id,'Unknown123')).toBeNull();
  expect(await serveBundleAsset(asset(logo.id,logo.id),owner,logo.id,logo.id)).toBeNull();
  expect(await serveBundleAsset(asset('Missing123',logo.id),owner,'Missing123',logo.id)).toBeNull();
 });

 it('serves a public page file to anyone',async()=>{
  const {id,logo}=await bundledPage('public');
  expect((await serveBundleAsset(asset(id,logo.id),ANONYMOUS_ACTOR,id,logo.id))?.status).toBe(200);
 });
});

describe('loadBundleAssetResources',()=>{
 it('loads every admitted file once, by its page-scoped address, for an authorized export',async()=>{
  const {owner,id,logo,css}=await bundledPage();
  const resources=await loadBundleAssetResources(new Request(`${BASE}/a/${id}/download`),owner,id);
  expect(resources.map(resource=>resource.url).sort()).toEqual([css,logo].map(receipt=>`/a/${id}/assets?dependency=${receipt.id}&revision=${receipt.revision}`).sort());
  const svg=resources.find(resource=>resource.url.includes(logo.id))!;
  expect(svg.contentType).toBe('image/svg+xml');
  expect(new TextDecoder().decode(svg.bytes)).toBe('<svg>☕</svg>');
 });
 it('refuses a page the reader cannot read',async()=>{
  const {id}=await bundledPage();
  await expect(loadBundleAssetResources(new Request(`${BASE}/a/${id}/download`),ANONYMOUS_ACTOR,id)).rejects.toThrow('Bundle page unavailable');
 });
});
