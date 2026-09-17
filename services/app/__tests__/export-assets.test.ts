import {describe,it,expect,vi} from 'vitest';
import * as assetDelivery from '@/lib/export/assets';
import {useAppHarness} from './harness';
import {getDb} from '@/lib/db';
import {objectStore,createS3Store, cachedReads} from '@/lib/object-store';
import {exportAssetResponse,exportAssetUrl} from '@/lib/export/assets';
import {GET as exportImage} from '@/app/a/[id]/export/route';
import {createArtifact} from '@/lib/artifacts';
import {mintToken} from '@/lib/tokens';
import {setServices} from '@/lib/services';
import {resetExportRenderer} from '@/lib/export';
import {mintExportKey} from '@/lib/export-key';

useAppHarness();
const id='11111111-1111-4111-8111-111111111111';
describe('persistent export delivery',()=>{
 it.each([
  ['http://assets.localhost:3030',200],
  ['http://localhost:3030',302],
  ['https://assets.example.com',302],
 ])('delivers image bytes safely when the configured asset origin is %s',async(origin,status)=>{
  const token=await mintToken('delivery'),row=await createArtifact(token.id,null,{format:'markup',content:'',source:'<p>delivery</p>',meta:{},title:'Delivery',description:null});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==','base64');
  const location=`${origin}/assets/export/${id}?key=${mintExportKey(`export-asset:${id}`)}`;
  const spy=vi.spyOn(assetDelivery,'exportAssetUrl').mockReturnValue(location);
  setServices({browser:{render:async()=>({ok:true,mime:'image/png',bytes:png})}});
  try {
   const response=await exportImage(new Request(`http://localhost:3030/a/${row.id}/export`,{headers:{'X-Artifactbin-Export-Delivery':'redirect'}}),{params:Promise.resolve({id:row.id})});
   expect(response.status).toBe(status);
   if(status===200){expect(response.headers.get('location')).toBeNull();expect(Buffer.from(await response.arrayBuffer())).toEqual(png);}
   else expect(response.headers.get('location')).toBe(location);
  }finally{spy.mockRestore();await resetExportRenderer();setServices({});}
 });

 it('redirects an authorized export to the persistent image and retains it across renderer resets',async()=>{
  const token=await mintToken('export'),row=await createArtifact(token.id,null,{format:'markup',content:'',source:'<p>hello</p>',meta:{},title:'Export',description:null});
  let calls=0;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==','base64');
  setServices({browser:{render:async()=>{calls++;return {ok:true,mime:'image/png',bytes:png};}}});
  try {
   for(let i=0;i<2;i++){
    const response=await exportImage(new Request(`http://localhost:3030/a/${row.id}/export`),{params:Promise.resolve({id:row.id})});
    expect(response.status).toBe(302);expect(response.headers.get('cache-control')).toBe('no-store');
    const asset=new URL(response.headers.get('location')!);
    const bytes=await exportAssetResponse(new Request(asset),asset.pathname.split('/').at(-1)!);
    expect(Buffer.from(await bytes.arrayBuffer())).toEqual(png);await resetExportRenderer();
   }
   expect(calls).toBe(1);
   const legacy=await exportImage(new Request(`http://localhost:3030/a/${row.id}/export`,{headers:{'X-Artifactbin-Protocol':'1'}}),{params:Promise.resolve({id:row.id})});
   expect(legacy.status).toBe(200);expect(Buffer.from(await legacy.arrayBuffer())).toEqual(png);
   expect(calls).toBe(1);
  }finally{await resetExportRenderer();setServices({});}
 });
 it('keeps S3 exports working when a browser has not enabled direct uploads',async()=>{
  const token=await mintToken('rollout'),row=await createArtifact(token.id,null,{format:'markup',content:'',source:'<p>hello</p>',meta:{},title:'Rollout',description:null});
  const store=objectStore(),original=store.signedUpload;let renders=0,uploads=0;
  store.signedUpload=async()=>({url:'https://storage.example/exports/objects/test.png',contentType:'image/png'});
  setServices({browser:{render:async()=>{renders++;return {ok:true,mime:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==','base64')};},renderAndUpload:async()=>{uploads++;return {ok:false,reason:'upload_unavailable'};}}});
  try{
   const response=await exportImage(new Request(`http://localhost:3030/a/${row.id}/export`),{params:Promise.resolve({id:row.id})});
   expect(response.status).toBe(302);expect(uploads).toBe(1);expect(renders).toBe(1);
  }finally{await resetExportRenderer();setServices({});if(original)store.signedUpload=original;else delete store.signedUpload;}
 });
 it('streams a published image through a scoped grant and rejects other scopes and expired grants',async()=>{
  const body=Buffer.from('image fixture'),key=`exports/objects/${id}.png`;
  await objectStore().put(key,body,'image/png');
  await (await getDb()).query('INSERT INTO export_images(id,artifact_id,object_key,mime,bytes,width,height) VALUES($1,$2,$3,$4,$5,1,1)',[id,'abc123',key,'image/png',body.length]);
  const url=exportAssetUrl(id,'http://localhost:3030');
  const response=await exportAssetResponse(new Request(url),id);
  expect(response.status).toBe(200);expect(await response.text()).toBe('image fixture');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  for(const token of [mintExportKey('abc123'),mintExportKey(`export-asset:${id}`,-1),'bad']){
   expect((await exportAssetResponse(new Request(`http://localhost/assets/export/${id}?key=${token}`),id)).status).toBe(404);
  }
 });
 it('signs one immutable S3 PUT without supplying permanent credentials to the browser',async()=>{
  const store=cachedReads(createS3Store({bucket:'fixture',region:'us-west-1',accessKeyId:'test-key',secretAccessKey:'test-secret',endpoint:'https://s3.us-west-1.amazonaws.com',forcePathStyle:true,prefix:'artifacts'}));
  const signed=await store.signedUpload!('exports/objects/test.png','image/png');
  const url=new URL(signed.url);
  expect(url.pathname).toBe('/fixture/artifacts/exports/objects/test.png');
  expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
  expect(signed.contentType).toBe('image/png');expect(signed.url).not.toContain('test-secret');
 });
});
