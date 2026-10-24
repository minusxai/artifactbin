import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {useAppHarness,mintAccountToken,request} from './harness';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as asset} from '@/app/a/[id]/assets/route';
import {identityForUser} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {importNativeHistory} from '@/lib/native-history-import';
import {canonicalizeHtmlPage} from '@/lib/html-page';
import {readHtmlPage} from '@/lib/html-publication';
import {prepareNativeRuntimeBundle} from '@/lib/native-runtime-bridge';
import type {NativeRuntimeAssembly} from '@/lib/native-runtime-bridge/contracts';
useAppHarness();
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function assembly():NativeRuntimeAssembly {
 const html='<html><head><link rel="stylesheet" href="./assets/style.css"><script type="module">import "./components/button.js";</script></head><body><af-button data-af-id="button">Save</af-button></body></html>';
 const files=[['components/button.js','import {label} from "./shared.js"; customElements.define("af-button",class extends HTMLElement {connectedCallback(){this.textContent=label;}});'],['components/shared.js','export const label="Ready";'],['assets/style.css','@import "./nested.css"; body{background-image:url(./mark.svg)}'],['assets/nested.css','af-button{color:rgb(10,20,30)}'],['assets/mark.svg','<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>']].map(([path,text])=>({path:path!,bytes:Buffer.from(text!),sha256:sha(text!)}));
 return {key:{sourceNamespace:'synthetic',sourceId:'source',version:3},sha256:'a'.repeat(64),result:{status:'complete',html,htmlSha256:sha(html),files}};
}
it('stages exact component and resource closures through normal publication and serves the real saved reader dependencies',async()=>{
 const owner=await mintAccountToken('synthetic_runtime_owner');
 const actor={...identityForUser(owner.userId,owner.id),tokenId:owner.id};
 const input=assembly(),options={pageId:'RuntimePage',actor,origin:'http://localhost:3000',visibility:'private' as const};
 const prepared=await prepareNativeRuntimeBundle(input,options);
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
