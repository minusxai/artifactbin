/** Normal publication, saved reader and dependency delivery without migration staging. */
import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {useAppHarness,mintAccountToken,request} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as asset} from '@/app/a/[id]/assets/route';
import {identityForUser} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {readHtmlPage} from '@/lib/html-publication';
vi.mock('@/lib/platform/config',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/platform/config')>();
 return {...actual,MAX_PDF_BYTES:50_000_000,MAX_FILE_BYTES:50_000_000};
});
useAppHarness();
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const sourceFiles=[['components/button.js','import {label} from "./shared.js"; customElements.define("af-button",class extends HTMLElement {connectedCallback(){this.textContent=label;}});','text/javascript'],['components/shared.js','export const label="Ready";','text/javascript'],['assets/style.css','@import "./nested.css"; body{background-image:url(./mark.svg)}','text/css'],['assets/nested.css','af-button{color:rgb(10,20,30)}','text/css'],['assets/mark.svg','<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>','image/svg+xml']];
const bundle=()=>({entryPath:'index.html',files:sourceFiles.map(([path,text,contentType])=>({path:path!,contentType:contentType!,base64:Buffer.from(text!).toString('base64')}))});
const html='<html><head><link rel="stylesheet" href="./assets/style.css"><script type="module">import "./components/button.js";</script></head><body><af-button data-af-id="button">Save</af-button></body></html>';
it('publishes a transitive component/resource closure idempotently and serves only authorized versioned bytes',async()=>{
 const owner=await mintAccountToken('mxmx_test_bundle_runtime'),other=await mintAccountToken('mxmx_test_bundle_stranger');
 const publish=()=>POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'html_bundle_runtime_0001'},json:{html,visibility:'private',publicationBundle:bundle()}}));
 const response=await publish();expect(response.status).toBe(201);const saved=await response.json();
 expect(saved.dependencyReceipts).toHaveLength(5);
 const before=(await (await getDb()).query('SELECT id FROM artifacts ORDER BY id')).rows;
 const replay=await publish();expect((await replay.json()).id).toBe(saved.id);expect((await (await getDb()).query('SELECT id FROM artifacts ORDER BY id')).rows).toEqual(before);
 const context={params:Promise.resolve({id:saved.id})};
 expect((await raw(request(`/a/${saved.id}/raw`),context)).status).toBe(404);
 const reader=await raw(request(`/a/${saved.id}/raw`,{token:owner.token}),context);expect(reader.status).toBe(200);expect(await reader.text()).toContain('data-af-id="button"');
 const page=await readHtmlPage(identityForUser(owner.userId,owner.id),saved.id);expect(page?.html).toContain('data-af-id="button"');
 for(const dependency of saved.dependencyReceipts){
  const url=`/a/${saved.id}/assets?dependency=${dependency.id}&revision=${dependency.revision}&version=1`;
  for(const token of [undefined,other.token])expect((await asset(request(url,{token}),context)).status).toBe(404);
  const served=await asset(request(url,{token:owner.token}),context);expect(served.status).toBe(200);const text=await served.text();
  if(dependency.path==='components/button.js'){expect(text).toContain(`/a/${saved.id}/assets?`);expect(text).not.toContain('./shared.js');expect(text).toContain('version=1');}
  if(dependency.path==='assets/style.css'){expect(text).not.toContain('./nested.css');expect(text).not.toContain('./mark.svg');expect(text).toContain('version=1');}
  if(dependency.path==='assets/mark.svg')expect(sha(text)).toBe(sha(sourceFiles.find(([path])=>path===dependency.path)![1]!));
 }
});
it('rejects an unresolved transitive import before creating any dependency',async()=>{
 const owner=await mintAccountToken('mxmx_test_bundle_invalid');const publicationBundle=bundle();publicationBundle.files=publicationBundle.files.filter(f=>f.path!=='components/shared.js');
 const response=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'html_bundle_runtime_invalid'},json:{html,publicationBundle}}));
 expect(response.status).toBe(400);expect((await (await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([]);
});
it('publishes a large PDF through its native tier and serves its exact bytes under the page ACL',async()=>{
 const owner=await mintAccountToken('mxmx_test_bundle_pdf'),other=await mintAccountToken('mxmx_test_bundle_pdf_other');
 const header=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF\n');
 const bytes=Buffer.concat([header,Buffer.alloc(4_350_759-header.length,0x20)]);
 const pdfResponse=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'html_bundle_pdf_asset_0001'},json:{pdf:'data:application/pdf;base64,'+bytes.toString('base64'),visibility:'private'}}));
 expect(pdfResponse.status).toBe(201);const pdf=await pdfResponse.json();
 const response=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':'html_bundle_pdf_page_0001'},json:{visibility:'private',html:'<html><body><a href="./doc.pdf">PDF</a></body></html>',publicationBundle:{entryPath:'index.html',files:[],mappings:{'doc.pdf':{kind:'asset',id:pdf.id,revision:'1',sha256:sha(bytes)}}}}}));
 expect(response.status).toBe(201);const page=await response.json(),context={params:Promise.resolve({id:page.id})};
 const url=`/a/${page.id}/assets?dependency=${pdf.id}&revision=1&version=1`;
 expect((await asset(request(url,{token:other.token}),context)).status).toBe(404);
 const served=await asset(request(url,{token:owner.token}),context);expect(served.status).toBe(200);expect(served.headers.get('content-type')).toContain('application/pdf');expect(sha(new Uint8Array(await served.arrayBuffer()))).toBe(sha(bytes));
});
