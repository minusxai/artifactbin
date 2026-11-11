/**
 * Internal: completes a confirmed publication: a page's canonical source, with its af-authoring
 * marker, replaces the input (or lands beside it when the input changed meanwhile); a data or media
 * file needs nothing written. A result file beside the journal makes a resume return the same.
 * Used by: toolbox-publish.mjs (re-exported as finishPublication).
 */
import {ToolError,optionalFile,hash,platform} from './toolbox-client.mjs';
import {saveSource} from './toolbox-source.mjs';

export async function finishPublication({saved,receipt,journal}){
 const resultFile=journal+'.result.json',previous=await optionalFile(resultFile);
if(previous){const result=JSON.parse(previous);if(result.id!==receipt.id||
   result.version!==receipt.version)throw new ToolError('receipt_mismatch',
   'Saved result does not match the replayed receipt.',4);if(result.source&&!await optionalFile(
   result.source))throw new ToolError('canonical_source_missing',
   'The saved canonical source is gone.',1,
   'Read the committed page to a fresh source path.',{journal,id:receipt.id});return result;}
if(saved.body.html!==undefined&&typeof receipt.html!=='string')throw new ToolError(
   'publication_recovered','The server recovered the identity without canonical HTML.',1,
   'Read the returned identity to a fresh source file; do not create a replacement.',{committed:
   true,id:receipt.id,journal});
 try{
 let written={},inPlace=false;
 if(typeof receipt.html==='string'){
if(!saved.source)throw new ToolError('source_snapshot_missing',
    'Publication journal has no source-output plan.',1);
  // The input is replaced only while it still holds exactly the published bytes; later author
  // edits keep the result beside it.
  const current=await optionalFile(saved.source.file);inPlace=!!current&&hash(current)===
   saved.source.sha256;
  written=await saveSource({record:receipt,server:saved.server,output:inPlace?saved.source.file:
   saved.source.output,entryPath:saved.source.entryPath,receipts:receipt.dependencyReceipts??[],
   localReferences:true,replace:inPlace});
 }
const result={id:receipt.id,url:receipt.url,...(receipt.user_page_url?{user_page_url:
  receipt.user_page_url}:{}),version:receipt.version,journal,...(written.source?{source:
   written.source}:{}),...(receipt.identity?{identity:receipt.identity}:{}),...(inPlace?
   {updatedInPlace:true}:written.source?{note:
   'The input changed during publication, so it was kept. Reapply those later edits to the saved '+
   'source before the next publish.'}:{})};
const {atomicWrite}=await platform();await atomicWrite(resultFile,JSON.stringify(result,null,
   2)+'\n',{exclusive:true});return result;
}catch(error){if(error.code==='source_snapshot_missing')throw error;throw new ToolError(
   'canonical_source_save_failed',
   'Server confirmed publication but the canonical source could not be saved.',1,
   'Retain this journal and receipt; read the committed page to a fresh source file.',{
   committed:true,id:receipt.id,version:receipt.version,journal,cause:error.code??
   'filesystem_error'});}
}
