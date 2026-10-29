import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {useAppHarness,mintAccountToken,request} from './harness';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as asset} from '@/app/a/[id]/assets/route';
import { identityForUser } from '@/lib/accounts';
import {reserveIds} from '@/lib/artifacts';
import {getDb} from '@/lib/platform';
import {importNativeHistory} from '@/lib/native-history-import';
import {canonicalizeHtmlPage} from '@/lib/html-page';
import {readHtmlPage} from '@/lib/html-publication';
import {prepareNativeRuntimeBundle, type NativeRuntimeAssembly} from '@/lib/native-runtime-bridge';
import {rewriteNativeRuntimePdfLinks} from '@/lib/native-runtime-bridge/pdf-source';
import {sniffAssetType} from '@/lib/web-ingest';
// This file exercises the real upload path with a 4.35 MB PDF. Use the regular
// production tier limits here; the API size-boundary tests keep their small caps.
vi.mock('@/lib/platform/config',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/platform/config')>();
 return {...actual,MAX_PDF_BYTES:50_000_000,MAX_FILE_BYTES:50_000_000};
});
useAppHarness();
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)])):value;
const digest=(value:unknown)=>sha(JSON.stringify(stable(value)));
function assembly():NativeRuntimeAssembly {
 const html='<html><head><link rel="stylesheet" href="./assets/style.css"><script type="module">import "./components/button.js";</script></head><body><af-button data-af-id="button">Save</af-button></body></html>';
 const files=[['components/button.js','import {label} from "./shared.js"; customElements.define("af-button",class extends HTMLElement {connectedCallback(){this.textContent=label;}});'],['components/shared.js','export const label="Ready";'],['assets/style.css','@import "./nested.css"; body{background-image:url(./mark.svg)}'],['assets/nested.css','af-button{color:rgb(10,20,30)}'],['assets/mark.svg','<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>']].map(([path,text])=>({path:path!,bytes:Buffer.from(text!),sha256:sha(text!)}));
 return {key:{sourceNamespace:'synthetic',sourceId:'source',version:3},sha256:'a'.repeat(64),result:{status:'complete',html,htmlSha256:sha(html),files}};
}
it('stages exact component and resource closures through normal publication and serves the real saved reader dependencies',async()=>{
 const owner=await mintAccountToken('synthetic_runtime_owner');
 const actor={...identityForUser(owner.userId,owner.id),tokenId:owner.id};
 const input=assembly(),options={pageId:'RuntimePage',actor,origin:'http://localhost:3000',visibility:'private' as const};
 const fileDigests=input.result.files!.map(({path,sha256})=>({path,sha256}));
 const legacyRequestKey=sha(JSON.stringify({kind:'native-runtime-v1',key:input.key,assemblySha256:input.sha256,pageId:options.pageId,sourceHtmlSha256:input.result.htmlSha256,fileDigests,owner:{userId:actor.userId,tokenId:actor.tokenId},visibility:options.visibility,shares:[]}));
 const legacyReservedIds=await reserveIds(actor,sha(legacyRequestKey+'_bundle_ids'));
 const prepared=await prepareNativeRuntimeBundle(input,options);
 // Reservation slots are canonical paths; receipt order retains source traversal.
 expect([...prepared.dependencies].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0).map(dependency=>dependency.id)).toEqual(legacyReservedIds.slice(0,prepared.dependencies.length));
 const {assetsSha256,...legacyReceipt}=prepared;
 expect(assetsSha256).toBe(sha(JSON.stringify(legacyReceipt)));
 expect(prepared.sourceHtmlSha256).toBe(input.result.htmlSha256);
 expect(prepared.fileDigests).toEqual(input.result.files!.map(({path,sha256})=>({path,sha256})));
 expect(prepared.dependencies).toHaveLength(5);
 expect(prepared.html).not.toContain('./components/');
 const db=await getDb();
 expect((await db.query('SELECT id FROM artifacts WHERE id=$1',[options.pageId])).rows).toEqual([]);
 const before=(await db.query('SELECT id FROM artifacts ORDER BY id')).rows;
 expect(await prepareNativeRuntimeBundle(input,options)).toEqual(prepared);
 expect((await db.query('SELECT id FROM artifacts ORDER BY id')).rows).toEqual(before);
 const canonical=canonicalizeHtmlPage(prepared.html);
 const history={sourceNamespace:input.key.sourceNamespace,sourceId:input.key.sourceId,selectionSha256:'b'.repeat(64),projectionSha256:prepared.assetsSha256,pageId:options.pageId,owner:{userId:owner.userId!,tokenId:owner.id},visibility:'private' as const,linkRole:'viewer' as const,shares:[],headVersion:3,revisions:[{page:{pageId:options.pageId,version:3,revision:'3',html:canonical.html,nextNodeId:canonical.ledger.nextNodeId,links:[]},ledger:canonical.ledger,sourceSha256:sha(canonical.html),title:'Synthetic runtime',description:null,createdAt:'2020-01-03T00:00:00.000Z',actorUserId:owner.userId,actorTokenId:owner.id,queries:[],mutations:[],htmlPublicationDependencies:prepared.dependencies}]};
 expect(await importNativeHistory(db,history)).toBe('created');
 expect(await importNativeHistory(db,history)).toBe('unchanged');
 const context={params:Promise.resolve({id:options.pageId})};
 expect((await raw(request('/a/'+options.pageId+'/raw'),context)).status).toBe(404);
 const reader=await raw(request('/a/'+options.pageId+'/raw',{token:owner.token}),context);
 expect(reader.status).toBe(200);
 expect(await reader.text()).toContain('data-af-id=\"button\"');
 const page=await readHtmlPage(actor,options.pageId);
 expect(page?.html).toContain('data-af-id="button"');
 for(const dependency of prepared.dependencies){
  const url=`/a/${options.pageId}/assets?dependency=${dependency.id}&revision=${dependency.revision}&version=3`;
  expect((await asset(request(url),context)).status).toBe(404);
  const served=await asset(request(url,{token:owner.token}),context);
  expect(served?.status).toBe(200);
  const text=await served!.text();
  if(dependency.path==='components/button.js'){expect(text).toContain('/a/RuntimePage/assets?');expect(text).not.toContain('./shared.js');expect(text).toContain('version=3');}
  if(dependency.path==='assets/style.css'){expect(text).not.toContain('./nested.css');expect(text).not.toContain('./mark.svg');expect(text).toContain('version=3');}
  if(dependency.path==='assets/mark.svg')expect(sha(text)).toBe(input.result.files!.find(f=>f.path===dependency.path)!.sha256);
 }
});
it('rejects tampered assembly bytes and unresolved local imports before creating any dependency',async()=>{
 const owner=await mintAccountToken('synthetic_runtime_invalid'),actor={...identityForUser(owner.userId,owner.id),tokenId:owner.id};
 const options={pageId:'RuntimeBad',actor,origin:'http://localhost:3000',visibility:'private' as const};
 const input=assembly();input.result.files![0]!.bytes[0]=0;
 await expect(prepareNativeRuntimeBundle(input,options)).rejects.toThrow('native_runtime_invalid');
 const missing=assembly();missing.result.files=missing.result.files!.filter(f=>f.path!=='components/shared.js');
 await expect(prepareNativeRuntimeBundle(missing,options)).rejects.toThrow('Unresolved local dependencies');
 expect((await (await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([]);
});

function sourcePdf(bytes=4_350_759){
 const header=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF\n');
 return Buffer.concat([header,Buffer.alloc(Math.max(0,bytes-header.length),0x20)]);
}
function pdfAssembly(bytes=sourcePdf()):NativeRuntimeAssembly{
 const path='assets/'+sha(bytes)+'.pdf',sourceReceipt={source:'ref:SourcePdf',sourceId:'SourcePdf',version:1,sourceRowSha256:'b'.repeat(64),kind:'pdf' as const,target:'./'+path,name:'Reviewed source PDF',bytes:bytes.length,pages:1};
 const receipt={...sourceReceipt,sha256:digest(sourceReceipt)};
 const html=`<html><body><a href="./${path}">Open source PDF</a><a href='./${path}?download=1#page=2'>Quoted source PDF</a><a href=./${path}?mode=raw#page=3>Unquoted source PDF</a><a href="https://example.test/reading">Original external link</a><template><a href='./${path}?template=1#page=4'>Template PDF</a></template></body></html>`;
 return {key:{sourceNamespace:'source',sourceId:'page',version:3},sha256:'a'.repeat(64),input:{fileReceipts:[receipt]},result:{status:'complete',html,htmlSha256:sha(html),files:[{path,bytes,sha256:sha(bytes)}]}};
}
it('publishes source PDF bytes through the validated PDF tier and maps the owned versioned receipt into the page',async()=>{
 const owner=await mintAccountToken('native_runtime_pdf_owner'),other=await mintAccountToken('native_runtime_pdf_other'),actor={...identityForUser(owner.userId,owner.id),tokenId:owner.id};
 const input=pdfAssembly(),options={pageId:'RuntimePdf',actor,origin:'http://localhost:3000',visibility:'private' as const};
 expect(sniffAssetType(Buffer.from(input.result.files![0]!.bytes))).toBe('application/pdf');
 const prepared=await prepareNativeRuntimeBundle(input,options),dependency=prepared.dependencies.find(d=>d.path===input.result.files![0]!.path)!;
 expect(prepared.html).toContain(`/a/RuntimePdf/assets?dependency=${dependency.id}&amp;revision=${dependency.revision}`);
 expect(prepared.html).toContain(`&amp;download=1#page=2`);
 expect(prepared.html).toContain(`&amp;mode=raw#page=3`);
 expect(prepared.html).toContain(`&amp;template=1#page=4`);
 expect(prepared.html).toContain('href="https://example.test/reading"');
 expect(dependency).toMatchObject({kind:'asset',sha256:input.result.files![0]!.sha256,sourceAssets:[{sourceId:'SourcePdf',sourceVersion:1,sourceRowSha256:'b'.repeat(64),sourceReceiptSha256:input.input!.fileReceipts![0]!.sha256,name:'Reviewed source PDF',bytes:input.result.files![0]!.bytes.length,pages:1}]});
 expect(prepared.objects).toContainEqual(expect.objectContaining({path:input.result.files![0]!.path,id:dependency.id,revision:dependency.revision,sha256:input.result.files![0]!.sha256,bytes:input.result.files![0]!.bytes.length,contentType:'application/pdf'}));
 const db=await getDb(),row=(await db.query<any>('SELECT id,version,format,user_id,token_id,visibility,title,meta FROM artifacts WHERE id=$1',[dependency.id])).rows[0];
 expect(row).toMatchObject({id:dependency.id,version:Number(dependency.revision),format:'pdf',user_id:owner.userId,token_id:owner.id,visibility:'private',title:'Reviewed source PDF',meta:{contentType:'application/pdf',bytes:input.result.files![0]!.bytes.length,pages:1,sha256:input.result.files![0]!.sha256}});
 const canonical=canonicalizeHtmlPage(prepared.html),history={sourceNamespace:input.key.sourceNamespace,sourceId:input.key.sourceId,selectionSha256:'c'.repeat(64),projectionSha256:prepared.assetsSha256,pageId:options.pageId,owner:{userId:owner.userId!,tokenId:owner.id},visibility:'private' as const,linkRole:'viewer' as const,shares:[],headVersion:3,revisions:[{page:{pageId:options.pageId,version:3,revision:'3',html:canonical.html,nextNodeId:canonical.ledger.nextNodeId,links:[]},ledger:canonical.ledger,sourceSha256:sha(canonical.html),title:'PDF page',description:null,createdAt:'2020-01-03T00:00:00.000Z',actorUserId:owner.userId,actorTokenId:owner.id,queries:[],mutations:[],htmlPublicationDependencies:prepared.dependencies}]};
 expect(await importNativeHistory(db,history)).toBe('created');
 const context={params:Promise.resolve({id:options.pageId})},url=`/a/${options.pageId}/assets?dependency=${dependency.id}&revision=${dependency.revision}&version=3`;
 expect((await asset(request(url,{token:other.token}),context)).status).toBe(404);
 const response=await asset(request(url,{token:owner.token}),context);expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/pdf');expect(sha(new Uint8Array(await response.arrayBuffer()))).toBe(sha(input.result.files![0]!.bytes));
});
it('rejects authored query keys that could replace the mapped asset identity',()=>{
 const imported={path:'assets/source.pdf',id:'SourceAsset',revision:'1',objectKey:'object',sha256:'a'.repeat(64),bytes:100,sourceAssets:[]};
 expect(()=>rewriteNativeRuntimePdfLinks('<a href="./assets/source.pdf?dependency=other#page=1">PDF</a>','RuntimePdf',[imported])).toThrow('native_runtime_pdf_link_query_conflict');
});
it('rejects malformed source PDF bytes before staging any artifact',async()=>{
 const owner=await mintAccountToken('native_runtime_bad_pdf_owner'),actor={...identityForUser(owner.userId,owner.id),tokenId:owner.id},input=pdfAssembly(Buffer.from('not a PDF'));
 await expect(prepareNativeRuntimeBundle(input,{pageId:'RuntimeBadPdf',actor,origin:'http://localhost:3000',visibility:'private'})).rejects.toThrow('native_runtime_pdf_invalid');
 expect((await (await getDb()).query("SELECT id FROM artifacts WHERE format='pdf'")).rows).toEqual([]);
});
it('replays the same PDF source identity without creating duplicate target assets after a failed page import',async()=>{
 const owner=await mintAccountToken('native_runtime_pdf_retry_owner'),actor={...identityForUser(owner.userId,owner.id),tokenId:owner.id},input=pdfAssembly(),options={pageId:'RuntimePdfRetry',actor,origin:'http://localhost:3000',visibility:'private' as const},db=await getDb();
 const first=await prepareNativeRuntimeBundle(input,options),firstId=first.dependencies.find(d=>d.path===input.result.files![0]!.path)!.id;
 const failedHistory={sourceNamespace:input.key.sourceNamespace,sourceId:input.key.sourceId,selectionSha256:'c'.repeat(64),projectionSha256:first.assetsSha256,pageId:options.pageId,owner:{userId:owner.userId!,tokenId:owner.id},visibility:'private' as const,linkRole:'viewer' as const,shares:[],headVersion:3,revisions:[]};
 await expect(importNativeHistory(db,failedHistory as never)).rejects.toThrow();
 const retry=await prepareNativeRuntimeBundle(input,options),retryId=retry.dependencies.find(d=>d.path===input.result.files![0]!.path)!.id;
 expect(retryId).toBe(firstId);expect(retry).toEqual(first);expect((await db.query("SELECT id FROM artifacts WHERE format='pdf'")).rows).toHaveLength(1);
});
