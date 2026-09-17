import {expect,it,vi} from 'vitest';
import {useAppHarness} from './harness';
import {prepareContentInput,applyPreparedContent} from '@/lib/story/prepare-content';
import {objectStore} from '@/lib/object-store';
import {prepareCatalog} from '@/lib/datasets/catalog';
import {mintToken} from '@/lib/tokens';
useAppHarness();
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" /></svg>');
for(const [kind,body] of Object.entries({
 rows:{dataset:[{n:1}]},
 csv:{dataset:'n\n1\n'},
 image:{image:`data:image/svg+xml;base64,${svg.toString('base64')}`},
 pdf:{pdf:`data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}`},
 file:{file:{filename:'data.csv',contentType:'text/csv',base64:Buffer.from('n\n1').toString('base64')}},
}))it(`prepares ${kind} bytes without persistence and applies the same prepared objects`,async()=>{
 const store=objectStore();const put=vi.spyOn(store,'put');
 const prepared=await prepareContentInput(body,{overByteQuota:async()=>false});
 expect(prepared instanceof Response ? await prepared.text() : prepared).not.toBeInstanceOf(Response);
 if(prepared instanceof Response)throw new Error(await prepared.text());
 expect(put).not.toHaveBeenCalled();expect(prepared.objects.length).toBeGreaterThan(0);
 const applied=await applyPreparedContent(prepared);
 expect(applied).toEqual(prepared.content);
 expect(put).toHaveBeenCalledTimes(prepared.objects.length);
 for(const object of prepared.objects)expect(await store.get(object.key)).toEqual(object.bytes);
 put.mockRestore();
});
it('prepares stored catalog models against staged data without persisting their source tables',async()=>{
 const token=await mintToken('preparation');const put=vi.spyOn(objectStore(),'put');
 try {
  const result=await prepareContentInput({dataset:{kind:'stored',tables:[{schema:'public',name:'rows',rows:[{n:3}]},{schema:'public',name:'summary',sql:'select sum(n) as total from rows'}]}},{prepareDataset:(input,objects)=>prepareCatalog(input,{tokenId:token.id,userId:null},undefined,objects)});
  expect(result instanceof Response ? await result.clone().text() : 'prepared').toBe('prepared');
  if(result instanceof Response)return;
  expect(put).not.toHaveBeenCalled();
  expect((result.content.meta.catalog as {tables:unknown[]}).tables[1]).toMatchObject({name:'summary',columns:[{name:'total',type:'number'}]});
 } finally {put.mockRestore();}
});
it('invalid markup and explicit remote imports have no preparation effects',async()=>{
 const put=vi.spyOn(objectStore(),'put');const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('unexpected fetch'));
 try {
  const invalid=await prepareContentInput({markup:'<Unknown /> <img src="https://example.org/a.png" />'});
  expect(invalid).toBeInstanceOf(Response);
  const remote=await prepareContentInput({imageUrl:'https://example.org/a.png'});
  expect(remote).toBeInstanceOf(Response);
  expect((await (remote as Response).json()).error).toBe('dry_run_unsupported');
  expect(put).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
 } finally {put.mockRestore();network.mockRestore();}
});
