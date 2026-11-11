/**
 * Internal: an HTML source's af-authoring marker, its last line and the only local record of the
 * page it publishes over (server, id, version, state, entryPath, the source's hash without it):
 * read, check, stamp and save it, and pick where read --output saves.
 * Used by: toolbox-publish.mjs, toolbox-publish-finish.mjs, read.mjs, toolbox-check-command.mjs,
 *   new-page.mjs, new-app.mjs, new-codebase-report.mjs.
 */
import path from 'node:path';
import {ToolError,hash,platform,exclusive,optionalFile,serverOrigin} from './toolbox-client.mjs';
const MARKER=/\n?<!-- af-authoring:([A-Za-z0-9_-]*) -->\n?/g;
/** @typedef {import('../../../lib/skills/author-toolbox-contract').AuthorMarker} AuthorMarker */
/** The marker's JSON, or null when the source has none; a repeated or unparsable one is refused. */
export function sourceIdentity(source){const all=[...source.matchAll(MARKER)];if(all.length>1)
  throw new ToolError('invalid_marker','Source has more than one af-authoring marker.',2,
  'Keep only the last one (publish wrote it), then publish again.');if(!all.length)return null;
 try{return JSON.parse(Buffer.from(all[0][1],'base64url').toString());}catch{return {};}}
export const stripMarker=source=>source.replace(MARKER,'');
/** @param {AuthorMarker} marker */
export const stampSource=(source,marker)=>stripMarker(source)+'\n<!-- af-authoring:'+
  Buffer.from(JSON.stringify(marker)).toString('base64url')+' -->\n';
/** The command that publishes FILE next: over a page, as it is (marked), or as a new page. */
export async function publishStep(file,shown=path.basename(file),artifact){
 const marked=artifact?null:sourceIdentity(String(await optionalFile(file)??''));
 return `node scripts/publish.mjs ${shown}`+(artifact?` --artifact ${artifact}`:marked?'':
  ' --create');}
/** The marker of FILE, checked: a whole marker for this server and a current version.
 * @returns {AuthorMarker|null} */
export function markerOf(file,source,server){
 const marker=sourceIdentity(source),name=path.basename(file),id=marker?.id;if(!marker)return null;
 const whole=/^[A-Za-z0-9]{6,12}$/.test(id??'')&&Number.isSafeInteger(marker.version)&&
  marker.version>=1&&typeof marker.state==='string'&&marker.state&&typeof marker.server===
  'string'&&typeof marker.entryPath==='string'&&!marker.entryPath.split('/').includes('..');
 const by=`node scripts/publish.mjs ${name} --artifact ${/^[A-Za-z0-9]{6,12}$/.test(id??'')?id:
  'ID'}`;
 if(!whole)throw new ToolError('invalid_marker',`${name}'s af-authoring marker is cut or was `+
  'written by hand, so publish cannot tell which version it replaces.',2,`To replace the page `+
  `with ${name}: ${by}.`);
 if(marker.server!==serverOrigin(server))throw new ToolError('marker_origin_mismatch',`${name} `+
  `is page ${id} on ${marker.server}, not on ${serverOrigin(server)}.`,2,`Publish it with `+
  `--server ${marker.server}, or as a new page there with --create after deleting its last line.`);
 if(marker.historical)throw new ToolError('historical_source',`${name} was read from saved `+
  `version ${marker.version}: publishing it would replace the newer page.`,2,
  `To make it the current page anyway: ${by}.`);
 return marker;
}
/** Writes a page record as editable source with its marker: `replace` only for publish's own
 * unchanged input or a read over a file still unchanged since; otherwise never over a file. */
export async function saveSource({record,server,output,entryPath=path.basename(output),receipts,
  localReferences=false,historical=false,replace=false}){
if(typeof record.html!=='string')throw new ToolError('not_html','This record is not editable HTML.',
   2);
 const shared=await platform();
 let source=localReferences?shared.authoringHtml(record.html,{server,pageId:record.id,entryPath,
  receipts:receipts??record.dependencyReceipts??[]}):record.html;
 source=stripMarker(source);
 source=stampSource(source,{server,id:record.id,version:record.version,state:record.state,
  sha256:hash(source),entryPath,...(historical?{historical:true}:{}),...(Number.isSafeInteger(
  record.sharing_revision)?{sharingRevision:record.sharing_revision}:{})});
 await (replace?shared.atomicWrite:exclusive)(output,source);
 return {source:path.resolve(output),id:record.id,version:record.version};
}
/** Where read --output FILE saves: FILE itself while it is new or still exactly what its marker
 * recorded (refreshed in place), else a FILE.fresh sibling, with a note saying so. */
export async function readTarget(file){
 const bytes=await optionalFile(file),text=bytes&&bytes.toString('utf8');
 if(!bytes||sourceIdentity(text)?.sha256===hash(stripMarker(text)))return {output:file,replace:
  Boolean(bytes)};
 const extension=path.extname(file),stem=file.slice(0,file.length-extension.length);
 for(let n=1;;n++){const output=`${stem}.fresh${n>1?'-'+n:''}${extension}`;
  if(!await optionalFile(output))return {output,replace:false,note:`${path.basename(file)} has `+
   `changes of its own since it was read, so this read went to ${path.basename(output)}: `+
   'reapply what you need there, then publish that file.'};}
}
