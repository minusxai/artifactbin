import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {mintAccountToken,useAppHarness} from '@/__tests__/harness';
import {identityForUser} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {prepareNativeRuntimeBundle,type NativeRuntimeAssembly} from '..';
useAppHarness();
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const file=(path:string,text:string|Buffer)=>({path,bytes:Buffer.from(text),sha256:sha(Buffer.from(text))});
function assembly(html='<html><head><link rel="stylesheet" href="./assets/style.css"></head><body><p data-af-id="p">Hi</p></body></html>',files=[file('assets/style.css','p{color:red}')]):NativeRuntimeAssembly{
 return {key:{sourceNamespace:'synthetic',sourceId:'source',version:1},sha256:'a'.repeat(64),result:{status:'complete',html,htmlSha256:sha(html),files}};
}
const owner=async(name:string)=>{const token=await mintAccountToken(name);return {...identityForUser(token.userId,token.id),tokenId:token.id};};
const artifacts=async()=>(await (await getDb()).query('SELECT id FROM artifacts ORDER BY id')).rows;

it('stages the closure as owned assets, rewrites the page onto them and replays idempotently',async()=>{
 const actor=await owner('nrb_stage'),options={pageId:'StagePage',actor,origin:'http://localhost:3000/ignored',visibility:'private' as const};
 const prepared=await prepareNativeRuntimeBundle(assembly(),options);
 expect(prepared).toMatchObject({pageId:'StagePage',key:{sourceNamespace:'synthetic',sourceId:'source',version:1},assemblySha256:'a'.repeat(64),fileDigests:[{path:'assets/style.css',sha256:sha('p{color:red}')}]});
 const [dependency]=prepared.dependencies;
 expect(prepared.dependencies).toHaveLength(1);
 expect(prepared.html).toContain(`/a/StagePage/assets?dependency=${dependency!.id}`);expect(prepared.html).not.toContain('./assets/style.css');
 expect(prepared.htmlSha256).toBe(sha(prepared.html));
 expect(prepared.objects).toEqual([expect.objectContaining({path:'assets/style.css',id:dependency!.id,sha256:sha('p{color:red}'),contentType:'text/css'})]);
 const {assetsSha256,...receipt}=prepared;expect(assetsSha256).toBe(sha(JSON.stringify(receipt)));
 // The page itself is never published here; replaying the same request creates nothing new.
 const before=await artifacts();expect(before.map(row=>row.id)).not.toContain('StagePage');
 expect(await prepareNativeRuntimeBundle(assembly(),options)).toEqual(prepared);expect(await artifacts()).toEqual(before);
});
it('refuses an assembly that is incomplete, tampered or misaddressed before writing anything',async()=>{
 const actor=await owner('nrb_invalid'),options={pageId:'BadPage1',actor,origin:'http://localhost:3000',visibility:'private' as const};
 const base=assembly(),before=await artifacts();
 const cases:NativeRuntimeAssembly[]=[
  {...base,result:{...base.result,status:'failed'}},
  {...base,result:{...base.result,htmlSha256:'b'.repeat(64)}},
  {...base,result:{...base.result,html:undefined}},
  {...base,result:{...base.result,files:undefined}},
  {...base,sha256:'not-a-sha'},
  {...base,key:{...base.key,version:0}},
  {...base,key:{...base.key,version:1.5}},
  {...base,key:{...base.key,sourceId:''}},
  {...base,result:{...base.result,files:[{...base.result.files![0]!,sha256:'c'.repeat(64)}]}},
 ];
 for(const input of cases)await expect(prepareNativeRuntimeBundle(input,options)).rejects.toThrow('native_runtime_invalid');
 for(const bad of [{pageId:'short'},{pageId:'has space!'},{actor:{...actor,tokenId:null}},{actor:{...actor,userId:null}}])await expect(prepareNativeRuntimeBundle(base,{...options,...bad} as never)).rejects.toThrow('native_runtime_invalid');
 await expect(prepareNativeRuntimeBundle(assembly(undefined,[]),options)).rejects.toThrow('Unresolved local dependencies');
 expect(await artifacts()).toEqual(before);
});
it('requires a verified source receipt for every bundled PDF before staging it',async()=>{
 const actor=await owner('nrb_pdf'),pdf=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF\n');
 const input=assembly('<html><body><a href="./assets/doc.pdf">PDF</a></body></html>',[file('assets/doc.pdf',pdf)]),before=await artifacts();
 await expect(prepareNativeRuntimeBundle(input,{pageId:'PdfPage1',actor,origin:'http://localhost:3000',visibility:'private'})).rejects.toThrow('native_runtime_pdf_receipt_missing');
 expect(await artifacts()).toEqual(before);
});
