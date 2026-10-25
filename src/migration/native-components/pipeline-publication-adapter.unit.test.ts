import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createNativePipelinePublication,selectNativePipelinePublicationPage} from './pipeline-publication-adapter.ts';
import {nativeDigest} from './selection.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture(id:string){const row={id,version:1,document:{},meta:{}};const raw=JSON.stringify({snapshot:{},heads:[row],versions:[]});const receipt={id,path:'page.json',bytes:Buffer.byteLength(raw),sha256:hash(raw),expectedVersion:1,distinctRevisions:1,archivedRows:0};const manifest=JSON.stringify({receipts:[receipt],failures:[]});return {bytes:Buffer.from(raw),manifest:{encoding:'base64' as const,data:Buffer.from(manifest).toString('base64'),sha256:hash(manifest)},revision:{key:{sourceNamespace:'fixture',sourceId:id,version:1},original:row,matchingArchives:[],rowSha256:nativeDigest(row),documentSha256:nativeDigest(row.document)}};}
test('shared publication selection binds two unrelated heads without retaining their mutable state',async()=>{for(const id of ['first','second']){const f=fixture(id);const page=await selectNativePipelinePublicationPage({selectionManifest:f.manifest,approvedSelectionManifestSha256:f.manifest.sha256},f.bytes,f.revision);assert.equal(page.sourceId,id);assert.equal(page.revisions.length,1);assert.equal(page.revisions[0]?.rowSha256,f.revision.rowSha256);}});
test('publication rejects source bytes and independently approved manifest substitution',async()=>{const f=fixture('first');await assert.rejects(selectNativePipelinePublicationPage({selectionManifest:f.manifest,approvedSelectionManifestSha256:'0'.repeat(64)},f.bytes,f.revision),/manifest/);await assert.rejects(selectNativePipelinePublicationPage({selectionManifest:f.manifest,approvedSelectionManifestSha256:f.manifest.sha256},Buffer.from('{}'),f.revision),/digest/);});
test('approved latest overlay cannot add an unselected source or replace the original receipt',async()=>{
 const f=fixture('first');const original=JSON.parse(Buffer.from(f.manifest.data,'base64').toString()).receipts[0];
 const encode=(value:unknown)=>{const raw=JSON.stringify(value);return {encoding:'base64' as const,data:Buffer.from(raw).toString('base64'),sha256:hash(raw)};};
 const overlay=encode({revisionScope:'latest',selectionUnchanged:true,priorManifestSha256:f.manifest.sha256,receipts:[{...original,priorReceipt:{...original,sha256:'0'.repeat(64)}}]});
 await assert.rejects(selectNativePipelinePublicationPage({selectionManifest:f.manifest,approvedSelectionManifestSha256:f.manifest.sha256,refreshManifest:overlay,approvedRefreshManifestSha256:overlay.sha256},f.bytes,f.revision),/refresh_prior/);
 const extra=encode({revisionScope:'latest',selectionUnchanged:true,priorManifestSha256:f.manifest.sha256,receipts:[{...original,id:'unselected',priorReceipt:original}]});
 await assert.rejects(selectNativePipelinePublicationPage({selectionManifest:f.manifest,approvedSelectionManifestSha256:f.manifest.sha256,refreshManifest:extra,approvedRefreshManifestSha256:extra.sha256},f.bytes,f.revision),/refresh_selection/);
});

test('host capabilities stay host-only while explicit schema or namespace substitution stops staging',async()=>{
 const configuration={shared:{schemas:{appSchema:'app',authSchema:'accounts'},identity:{plan:{sourceNamespace:'approved'}}}} as Parameters<typeof createNativePipelinePublication>[0];
 const callback=createNativePipelinePublication(configuration);let staged=0;
 const invocation={context:{assembly:{sha256:'assembly',key:{sourceNamespace:'wrong',sourceId:'first',version:1}},revision:{key:{sourceNamespace:'wrong',sourceId:'first',version:1}}},reviewedRecipe:{assemblySha256:'assembly',authority:{appSchema:'app',authSchema:'accounts',capabilities:['operator']}},prepareRuntime:async()=>{staged++;throw Error('unexpected');}} as unknown as Parameters<typeof callback>[0];
 await assert.rejects(callback(invocation),/namespace/);assert.equal(staged,0);
 invocation.reviewedRecipe.authority.authSchema='decoy';await assert.rejects(callback(invocation),/authority_binding/);assert.equal(staged,0);
});
test('reviewed raw relation capture binds before staging without a precomputed target projection',async()=>{
 const f=fixture('first');const raw=Buffer.from(JSON.stringify({annotations:[{id:'source-note',artifact_id:'first',body:'Retained source note'}],members:[]}));
 const configuration={selectionManifest:f.manifest,approvedSelectionManifestSha256:f.manifest.sha256,relations:{encoding:'base64',data:raw.toString('base64'),sha256:hash(raw.toString())},shared:{schemas:{appSchema:'app',authSchema:'accounts'},identity:{plan:{sourceNamespace:'fixture'}}}} as Parameters<typeof createNativePipelinePublication>[0];
 const callback=createNativePipelinePublication(configuration);let staged=0;
 const invocation={context:{assembly:{sha256:'assembly',key:f.revision.key,result:{html:'<html></html>'}},revision:f.revision},reviewedRecipe:{assemblySha256:'assembly',authority:{appSchema:'app',authSchema:'accounts'}},files:{comments:Buffer.from(JSON.stringify({annotations:[]})),compiledHtml:Buffer.from('<html></html>'),sourceHead:Buffer.from('{}')},prepareRuntime:async()=>{staged++;throw Error('unexpected');}} as unknown as Parameters<typeof callback>[0];
 await assert.rejects(callback(invocation),/raw_relations/);assert.equal(staged,0);
 invocation.files.comments=raw;await assert.rejects(callback(invocation),/canonical_file_digest/);assert.equal(staged,0);
 invocation.files.compiledHtml=Buffer.from('<html>substituted</html>');await assert.rejects(callback(invocation),/compiled_html/);assert.equal(staged,0);
});
