import {localIdentities} from '../identities';
import {previewGraph} from './graph';
import {collectRefUses} from '../../../app/lib/story/data/refs';
/** Browser offers are data, never executable HTML. The existing importer owns validation, conflicts and atomic writes. */
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {PREVIEW_CONNECT_MAX_BYTES} from '../../../contracts/src/preview-connect';
import {atomicWrite,privateDirectory} from '../files';
import {CliError} from '../errors';
import {readArtifactFileHtml,importLocalHtml} from '../local-html-import';
import {loadWorkspace} from '../workspace';

function readOfferFile(html:string){try{return readArtifactFileHtml(html);}catch(error){if(error instanceof CliError)throw error;throw new CliError('invalid_html',error instanceof Error?error.message:String(error));}}

export function inspectPreviewOffer(value:unknown){
 if(!value||typeof value!=='object')throw new CliError('invalid_html','Choose an artifactbin HTML file.');
 const input=value as {html?:unknown;filename?:unknown;target?:unknown};
 if(typeof input.html!=='string'||Buffer.byteLength(input.html)>PREVIEW_CONNECT_MAX_BYTES||typeof input.filename!=='string'||input.filename.length>255)throw new CliError('invalid_html','Choose an artifactbin HTML file smaller than 25 MB.');
 const file=readOfferFile(input.html);
 const basename=input.filename.split(/[\\/]/).pop()!.replace(/\.html$/i,'').replace(/\.jsx$/i,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'');
 const target=input.target??`${basename||'document'}.jsx`;
 if(typeof target!=='string'||!target.toLowerCase().endsWith('.jsx')||target.length>500||/[\\:\x00-\x1f]/.test(target)||target.split('/').some(part=>!part||part.startsWith('.')||part==='node_modules'))throw new CliError('invalid_html','Choose a relative JSX filename within this workspace, such as report.jsx.');
 return {html:input.html,title:file.metadata.title,comments:file.threads.length,target};
}
export async function importPreviewOffer(root:string,home:string,value:unknown){
 const offer=inspectPreviewOffer(value),directory=join(root,'.artifactbin','imports');
 const workspace=await loadWorkspace(root,home),file=readOfferFile(offer.html);
 try{
 const identities=await localIdentities(workspace),future:Record<string,string>={[offer.target]:file.source};
 // Downloads restore their approved embedded datasets/media under newly generated paths. They must not accidentally
 // resolve to an old external registration during preflight; the importer itself validates and registers those bytes.
 if(!file.localWorkspace){
  for(const imported of file.island.dataflow?.flow.imports??[])delete identities[imported.ref];
  for(const ref of collectRefUses(file.source)??[])if(['image','file','pdf','asset'].includes(ref.kind))delete identities[ref.id];
 }else{
  identities[file.localWorkspace.documentId]=offer.target;
  for(const [id,asset] of Object.entries(file.localWorkspace.assets)){identities[id]=asset.path;future[asset.path]=Buffer.from(asset.base64,'base64').toString('utf8');}
 }
 await previewGraph(root,offer.target,identities,future);
 }catch(error){throw new CliError('invalid_html',`A referenced preview dependency is unavailable: ${error instanceof Error?error.message:String(error)}`);}

 await privateDirectory(directory);
 const path=join(directory,`${randomUUID()}.jsx.html`);
 try{
  await atomicWrite(path,Buffer.from(offer.html));
  return await importLocalHtml(workspace,path,offer.target);
 }finally{await rm(path,{force:true});}
}

export function previewConnectPage():string{
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to artifactbin preview</title><link rel="stylesheet" href="/bundle/chrome.css"></head><body><main id="afbin-connect"><h1>Import an HTML file</h1><p>Start with an artifactbin .jsx.html file. Importing creates or reconciles a workspace copy; the original HTML file is unchanged.</p><p>JavaScript is required to choose a file and confirm its import.</p></main><script type="module" src="/bundle/connect.js"></script></body></html>';
}
