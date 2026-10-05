/** Browser offers are data, never executable HTML. The existing importer owns validation, conflicts and atomic writes. */
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {PREVIEW_CONNECT_MAX_BYTES} from '../../../contracts/src/preview-connect';
import {atomicWrite,privateDirectory} from '../files';
import {CliError} from '../errors';
import {readArtifactFileHtml,importLocalHtml} from '../local-html-import';
import {loadWorkspace} from '../workspace';

export function inspectPreviewOffer(value:unknown){
 if(!value||typeof value!=='object')throw new CliError('invalid_html','Choose an artifactbin HTML file.');
 const input=value as {html?:unknown;filename?:unknown;target?:unknown};
 if(typeof input.html!=='string'||Buffer.byteLength(input.html)>PREVIEW_CONNECT_MAX_BYTES||typeof input.filename!=='string'||input.filename.length>255)throw new CliError('invalid_html','Choose an artifactbin HTML file smaller than 25 MB.');
 const file=readArtifactFileHtml(input.html);
 const basename=input.filename.split(/[\\/]/).pop()!.replace(/\.html$/i,'').replace(/\.jsx$/i,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'');
 const target=input.target??`${basename||'document'}.jsx`;
 if(typeof target!=='string'||!target.toLowerCase().endsWith('.jsx')||target.length>500||/[\\:\x00-\x1f]/.test(target)||target.split('/').some(part=>!part||part.startsWith('.')||part==='node_modules'))throw new CliError('invalid_html','Choose a relative JSX filename within this workspace, such as report.jsx.');
 return {html:input.html,title:file.metadata.title,comments:file.threads.length,target};
}
export async function importPreviewOffer(root:string,home:string,value:unknown){
 const offer=inspectPreviewOffer(value),directory=join(root,'.artifactbin','imports');
 await privateDirectory(directory);
 const path=join(directory,`${randomUUID()}.jsx.html`);
 try{
  await atomicWrite(path,Buffer.from(offer.html));
  return await importLocalHtml(await loadWorkspace(root,home),path,offer.target);
 }finally{await rm(path,{force:true});}
}

export function previewConnectPage():string{
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to artifactbin preview</title><link rel="stylesheet" href="/bundle/chrome.css"></head><body><main id="afbin-connect"><h1>Import an HTML file</h1><p>Start with an artifactbin .jsx.html file. Importing creates or reconciles a workspace copy; the original HTML file is unchanged.</p><p>JavaScript is required to choose a file and confirm its import.</p></main><script type="module" src="/bundle/connect.js"></script></body></html>';
}
