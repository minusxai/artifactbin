/**
 * Internal: completes a confirmed publication: writes the canonical source/baseline pair (or the
 * data companion) and a result file beside the journal, so a resume returns the same result.
 * Used by: toolbox-publish.mjs (re-exported as finishPublication).
 */
import path from 'node:path';
import {ToolError,optionalFile,hash,platform} from './toolbox-client.mjs';
import {saveAuthoringPair} from './toolbox-source.mjs';

export async function finishPublication({saved,receipt,journal}){
 const resultFile=journal+'.result.json',previous=await optionalFile(resultFile);
if(previous){const result=JSON.parse(previous);if(result.id!==receipt.id||
   result.version!==receipt.version)throw new ToolError('receipt_mismatch',
   'Saved result does not match the replayed receipt.',4);if(!await optionalFile(result.source)||
   !await optionalFile(result.baseline))throw new ToolError('canonical_pair_missing',
   'Saved canonical output pair is incomplete.',1,
   'Read the committed artifact to a fresh source path.',{journal,id:receipt.id});return result;}
 let pair;
 // The input is replaced only while it still holds exactly the published bytes; later author edits
 // keep the result beside it.
const current=saved.source?.file?await optionalFile(saved.source.file):null,inPlace=!!current&&hash(
   current)===saved.source.sha256;
if(saved.body.html!==undefined&&typeof receipt.html!=='string')throw new ToolError(
   'publication_recovered','The server recovered the identity without canonical HTML.',1,
   'Read the returned identity to a fresh authoring pair; do not create a replacement.',{committed:
   true,id:receipt.id,journal});
 try{
 if(typeof receipt.html==='string'){
if(!saved.source)throw new ToolError('source_snapshot_missing',
    'Publication journal has no source-output plan.',1);
pair=await saveAuthoringPair({record:receipt,server:saved.server,output:inPlace?saved.source.file:
    saved.source.output,root:saved.source.root,receipts:receipt.dependencyReceipts??[],
    localReferences:true,replace:inPlace,backendLinks:saved.body.html===undefined?[]:(
    await platform()).previewBackendLinks(saved.body.html)});
 }else{
  const output=inPlace?saved.source.file:saved.source.output,body=saved.body;
let bytes;if(body.dataset!==undefined)bytes=typeof body.dataset==='string'?body.dataset:
    JSON.stringify(body.dataset,null,2)+'\n';else bytes=Buffer.from(body.file.base64,'base64');
const {exclusive}=await import('./toolbox-client.mjs'),{atomicWrite}=await platform();if(
    !inPlace)await exclusive(output,bytes);
const companion=output+'.af.json',write=inPlace?atomicWrite:exclusive;await write(companion,
    JSON.stringify({kind:'data-baseline',schema:1,server:saved.server,id:receipt.id,version:
    receipt.version,state:receipt.state,format:receipt.format,...(body.file?{contentType:
    body.file.contentType,filename:body.file.filename}:{}),sourceFile:path.basename(output),
    historical:false},null,2)+'\n');pair={source:output,baseline:companion};
 }
const result={id:receipt.id,url:receipt.url,version:receipt.version,journal,...pair,...(
   receipt.identity?{identity:receipt.identity}:{}),...(inPlace?{updatedInPlace:true}:
   saved.source?.file?{note:
   'The input changed during publication, so it was kept. Reapply those later edits to the saved '+
   'source before the next publish.'}:{})};
const {atomicWrite}=await platform();await atomicWrite(resultFile,JSON.stringify(result,null,
   2)+'\n',{exclusive:true});return result;
}catch(error){throw new ToolError('canonical_pair_save_failed',
   'Server confirmed publication but the canonical output pair could not be completed.',1,
   'Retain this journal and receipt; read the committed identity to a fresh authoring pair.',{
   committed:true,id:receipt.id,version:receipt.version,journal,cause:error.code??
   'filesystem_error'});}
}
