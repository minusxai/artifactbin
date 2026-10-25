import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createNativePipelinePublication,selectNativePipelinePublicationPage} from './pipeline-publication-adapter.ts';
import {nativeDigest} from './selection.ts';
import {prepareNativePublication,encodeNativePublicationBytes} from './pipeline-publication.ts';
test('an unmapped selected comment-image actor is rejected before any host is prepared',async()=>{
 const key={sourceNamespace:'fixture',sourceId:'page',version:1},row={id:'page',version:1,document:{}};
 const targets={actors:{},users:{owner:{userId:'mapped-owner',email:null}},tokens:{}};
 const input={selection:{sourceNamespace:'fixture',page:{sourceId:'page',headVersion:1,revisions:[{key,original:row,rowSha256:nativeDigest(row),documentSha256:nativeDigest(row.document)}]}},assemblies:[{key,input:{analysis:{documentSha256:nativeDigest(row.document)}},result:{status:'complete'}}],shared:{targets,maps:{pages:{}},identity:{approvedPlanSha256:'approved',plan:{sha256:'approved',sourceNamespace:'fixture',targets,artifactIds:{}}}},relations:encodeNativePublicationBytes(Buffer.from(JSON.stringify({annotations:[{id:'note',artifact_id:'page'}],comment_images:[{id:'image',annotation_id:'note',user_id:'owner',token_id:'unmapped-token'}]})))} as unknown as Parameters<typeof prepareNativePublication>[0];
 let prepared=0;
 await assert.rejects(prepareNativePublication(input,{prepare:async()=>{prepared++;throw Error('unexpected-host');}} as Parameters<typeof prepareNativePublication>[1]),/native_publication_comment_identity_missing/);
 assert.equal(prepared,0);
});
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

test('latest publication preserves the full admitted canonical revision witness for head-only projection',async()=>{
 const f=fixture('first');const old={...f.revision.original,version:1,document:{old:true}},head={...f.revision.original,version:2,document:{current:true}};
 const raw=JSON.stringify({snapshot:{},heads:[head],versions:[old]});const receipt={id:'first',path:'page.json',bytes:Buffer.byteLength(raw),sha256:hash(raw),expectedVersion:2,distinctRevisions:2,archivedRows:1};
 const manifestRaw=JSON.stringify({receipts:[receipt],failures:[]});const manifest={encoding:'base64' as const,data:Buffer.from(manifestRaw).toString('base64'),sha256:hash(manifestRaw)};
 const revision={...f.revision,key:{...f.revision.key,version:2},original:head,rowSha256:nativeDigest(head),documentSha256:nativeDigest(head.document)};
 const page=await selectNativePipelinePublicationPage({selectionManifest:manifest,approvedSelectionManifestSha256:manifest.sha256},Buffer.from(raw),revision);
 assert.equal(page.headVersion,2);assert.equal(page.sourceFile.distinctRevisions,2);assert.deepEqual(page.revisions.map(r=>r.key.version),[1,2]);assert.equal(page.revisions.find(r=>r.key.version===2)?.rowSha256,revision.rowSha256);
});
