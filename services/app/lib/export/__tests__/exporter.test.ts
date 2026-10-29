/**
 * The exporter's interface: the query parsers, the cache key, the read key, and the one export answer behind both
 * doors, against a stub browser service (the registered service is the boundary; no Chromium here).
 */
import {randomUUID} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import type {RenderRequest} from '@artifactbin/contracts';
import {CARD_HEIGHT,CARD_WIDTH} from '@artifactbin/contracts';
import {useAppHarness} from '@/__tests__/harness';
import {setServices} from '@/lib/platform';
import {EXPORT_RENDER_GENERATION,exportCacheKey,exportImageResponse,mintExportKey,parseExportCapture,parseExportFormat,parseExportSlide,renderArtifactImage,resetExportRenderer,verifyExportKey} from '..';

useAppHarness();
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==','base64');
type Verdict=Awaited<ReturnType<NonNullable<Parameters<typeof setServices>[0]['browser']>['render']>>;
function browser(answer:(request:RenderRequest)=>Verdict){
 const requests:RenderRequest[]=[];
 setServices({browser:{render:async request=>{requests.push(request);return answer(request);}}});
 return requests;
}
const page=(format='html')=>({id:randomUUID().replace(/-/g,'').slice(0,12),version:1,edit_id:randomUUID(),format,source:'<p>☕</p>'}) as Parameters<typeof exportImageResponse>[0];
const BASE='http://localhost:3030';
afterEach(async()=>{await resetExportRenderer();setServices({});});

describe('query parsers',()=>{
 it('read format, capture and slide, defaulting the absent ones and refusing the rest',()=>{
  expect([parseExportFormat('png'),parseExportFormat('jpg')]).toEqual(['png','jpg']);
  for(const value of [null,'','PNG','jpeg','webp'])expect(parseExportFormat(value)).toBeNull();
  expect([parseExportCapture(null),parseExportCapture('full'),parseExportCapture('card'),parseExportCapture('preview')]).toEqual(['full','full','card','preview']);
  for(const value of ['','Full','og'])expect(parseExportCapture(value)).toBeNull();
  expect([parseExportSlide(null),parseExportSlide('1'),parseExportSlide('12')]).toEqual([0,1,12]);
  for(const value of ['','0','01','-1','1.5',' 2','2 ','１'])expect(parseExportSlide(value)).toBeNull();
 });
});

describe('the cache key',()=>{
 it('names the artifact, the capture, the generation and the format, never the revision',()=>{
  const artifact={id:'abc123',version:4,edit_id:'e1'};
  expect(exportCacheKey(artifact,'png','full')).toBe(`abc123:full-g${EXPORT_RENDER_GENERATION}:png`);
  expect(exportCacheKey({...artifact,version:5,edit_id:'e2'},'png','full')).toBe(exportCacheKey(artifact,'png','full'));
  expect(exportCacheKey(artifact,'jpg','card')).toMatch(new RegExp(`^abc123:card-${CARD_WIDTH}x${CARD_HEIGHT}-r\\d+-g${EXPORT_RENDER_GENERATION}:jpg$`));
  expect(exportCacheKey(artifact,'png','full',3)).toBe(`abc123:slide-3-g${EXPORT_RENDER_GENERATION}:png`);
  expect(exportCacheKey(artifact,'png','preview')).toMatch(/^abc123:preview-v\d+-g\d+:png$/);
 });
 it('splits on a canonical selection and an archived version, and leaves the head key unchanged',()=>{
  const artifact={id:'abc123',version:4};
  const head=exportCacheKey(artifact,'png','full');
  const picked=exportCacheKey(artifact,'png','full',0,'region=Zürich');
  expect(picked).toMatch(new RegExp(`^abc123:full-g${EXPORT_RENDER_GENERATION}-p[0-9a-f]{12}:png$`));
  expect(exportCacheKey(artifact,'png','full',0,'region=Köln')).not.toBe(picked);
  expect(exportCacheKey(artifact,'png','full',0,'',2)).toBe(`abc123:full-g${EXPORT_RENDER_GENERATION}-v2:png`);
  expect(exportCacheKey(artifact,'png','full',0,'',null)).toBe(head);
 });
});

describe('the read key',()=>{
 it('verifies only for its own artifact and before it expires',()=>{
  const key=mintExportKey('abc123');
  expect(verifyExportKey('abc123',key)).toBe(true);
  expect(verifyExportKey('abc124',key)).toBe(false);
  expect(verifyExportKey('abc123',mintExportKey('abc123',-1))).toBe(false);
 });
 it('accepts exactly one spelling of a key',()=>{
  const [expiry,mac]=mintExportKey('abc123').split('.') as [string,string];
  for(const key of [undefined,'','abc',`0${expiry}.${mac}`,`+${expiry}.${mac}`,` ${expiry}.${mac}`,`${expiry}.${mac}.x`,`${expiry}.${mac.toUpperCase()}`,`${expiry}.${mac.slice(1)}`,`${expiry}.${'0'.repeat(64)}`])expect(verifyExportKey('abc123',key)).toBe(false);
 });
});

describe('the export answer',()=>{
 it('refuses unknown refresh, format, mode, slide and crop before any render',async()=>{
  const requests=browser(()=>({ok:true,mime:'image/png',bytes:PNG}));
  const cases:Array<[Record<string,string>,string]>=[[{refresh:'2'},'unknown_refresh'],[{format:'gif'},'unknown_format'],[{mode:'og'},'unknown_mode'],[{slide:'0'},'unknown_slide'],[{mode:'preview',crop:'nonsense'},'unknown_crop']];
  for(const [query,error] of cases){
   const response=await exportImageResponse(page(),query,BASE);
   expect(response.status).toBe(400);
   expect((await response.json() as {error:string}).error).toBe(error);
  }
  expect(requests).toEqual([]);
 });

 it('photographs the page by a scoped short-lived key, then serves the stored image without rendering again',async()=>{
  const requests=browser(()=>({ok:true,mime:'image/png',bytes:PNG}));
  const artifact=page();
  for(let i=0;i<2;i++){
   const response=await exportImageResponse(artifact,{},BASE);
   expect(response.status).toBe(200);
   expect(response.headers.get('content-type')).toBe('image/png');
   expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  }
  expect(requests).toHaveLength(1);
  const url=new URL(requests[0]!.url);
  expect(url.pathname).toBe(`/a/${artifact.id}/raw`);
  expect(url.searchParams.get('chrome')).toBe('0');
  expect(verifyExportKey(artifact.id,url.searchParams.get('key')!)).toBe(true);
  expect(verifyExportKey('someoneelse',url.searchParams.get('key')!)).toBe(false);
  expect(requests[0]).toMatchObject({format:'png',selector:'body',capture:'full',sameOriginOnly:true});
 });

 it('photographs an archived version on the address that validates it, under its own cache key',async()=>{
  const requests=browser(()=>({ok:true,mime:'image/png',bytes:PNG}));
  const artifact=page();
  expect((await exportImageResponse(artifact,{},BASE)).status).toBe(200);
  expect((await exportImageResponse(artifact,{version:1},BASE)).status).toBe(200);
  expect(requests).toHaveLength(2);
  expect(new URL(requests[1]!.url).searchParams.get('version')).toBe('1');
 });

 it('names a missing slide with the count, and maps unavailable and navigation verdicts',async()=>{
  browser(()=>({ok:false,reason:'no_slide',slides:3}));
  const missing=await exportImageResponse(page(),{slide:'7'},BASE);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({error:'slide_not_found',slides:3});
  await resetExportRenderer();
  browser(()=>({ok:false,reason:'unavailable'}));
  const unavailable=await exportImageResponse(page(),{},BASE);
  expect([unavailable.status,(await unavailable.json() as {error:string}).error]).toEqual([503,'render_unavailable']);
  await resetExportRenderer();
  const navigations=browser(()=>({ok:false,reason:'navigation'}));
  const failed=await exportImageResponse(page(),{},BASE);
  expect([failed.status,(await failed.json() as {error:string}).error]).toEqual([500,'render_failed']);
  // An unreachable page is not retried.
  expect(navigations).toHaveLength(1);
 });

 it('renders the editor preview volatile at card size and a data tier inside the app main',async()=>{
  const requests=browser(()=>({ok:true,mime:'image/jpeg',bytes:PNG}));
  const preview=await exportImageResponse(page(),{mode:'preview',format:'jpg'},BASE);
  expect(preview.status).toBe(200);
  expect(preview.headers.get('cache-control')).toBe('private, max-age=86400');
  expect(requests[0]).toMatchObject({viewport:{width:CARD_WIDTH,height:CARD_HEIGHT},quality:85});
  const dataset=page('dataset');
  expect((await exportImageResponse(dataset,{},BASE)).status).toBe(200);
  expect(requests[1]!.selector).toBe('main');
  expect(new URL(requests[1]!.url).pathname).toBe(`/a/${dataset.id}`);
 });
});

describe('renderArtifactImage',()=>{
 it('returns bytes from a volatile render and from the stored cache, and narrows navigation to failed',async()=>{
  const requests=browser(()=>({ok:true,mime:'image/png',bytes:PNG}));
  const artifact=page();
  const options={pageUrl:()=>`${BASE}/a/${artifact.id}/raw`,target:'body'};
  expect(await renderArtifactImage(artifact,'png',{...options,volatile:true})).toEqual({ok:true,mime:'image/png',bytes:PNG});
  expect(await renderArtifactImage(artifact,'png',options)).toEqual({ok:true,mime:'image/png',bytes:PNG});
  expect(await renderArtifactImage(artifact,'png',options)).toEqual({ok:true,mime:'image/png',bytes:PNG});
  expect(requests).toHaveLength(2);
  await resetExportRenderer();
  browser(()=>({ok:false,reason:'navigation'}));
  expect(await renderArtifactImage(page(),'png',{...options,volatile:true})).toEqual({ok:false,reason:'failed'});
 });
});
