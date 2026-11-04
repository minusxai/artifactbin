/**
 * Internal: the authoring pair: a local source file plus its .af.json baseline companion; load,
 * validate, stamp and save them, and restore local backend hrefs.
 * Used by: toolbox-publish.mjs, toolbox-publish-finish.mjs, read.mjs.
 */
import path from 'node:path';
import {readFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {ToolError,hash,platform,exclusive,jsonFile,optionalFile,
  serverOrigin} from './toolbox-client.mjs';
const marker=/<!-- af-authoring:([A-Za-z0-9_-]+) -->/g;
/** The one next step for a file whose companion is missing or no longer matches it. */
export const pairRecovery=(name,id)=>`To replace page ${id} with ${name}: node `+
  `scripts/publish.mjs `+
  `${name} --artifact ${id}. To start again from the page: node scripts/read.mjs ${id} --output `+
  `${name}. Never copy or hand-edit .af.json companions.`;
export const UNPAIRED=(name,id)=>pairRecovery(name,id)+' For a new page instead: --create.';
export function sourceIdentity(source){const all=[...source.matchAll(marker)];if(
  all.length>1)throw new ToolError('ambiguous_identity','Source has multiple authoring identities.',
  2);if(!all.length)return null;try{return JSON.parse(Buffer.from(all[0][1],'base64url').toString(
  ));}catch{throw new ToolError('invalid_identity','Source identity is malformed.',2);}}
/** Canonical HTML drops resolver (af-resolver) hrefs; put the author's local
 * path back so later backend edits are published. */
export function restoreBackendHrefs(source,links){
const hrefs=new Map((links??[]).filter(link=>link.name&&link.href).map(link=>[link.name,
   link.href]));if(!hrefs.size)return source;
 return source.replace(/<link\b[^>]*>/gi,tag=>{
  if(!/\brel\s*=\s*["'][^"']*\baf-resolver\b/i.test(tag)||/\shref\s*=/i.test(tag))
   return tag;
  const name=tag.match(/\sdata-af-name\s*=\s*["']([^"']+)["']/i)?.[1],href=name&&hrefs.get(name);
return href?tag.replace(/^<link\b/i,'<link href="'+href.replace(/&/g,'&amp;').replace(/"/g,
    '&quot;')+'"'):tag;
 });
}
export function stampSource(source,identity){return source.replace(marker,
  '')+'\n<!-- af-authoring:'+Buffer.from(JSON.stringify(identity)).toString('base64url')+' -->\n';}
/** @param {import('../../../lib/skills/author-toolbox-contract').AuthorBaseline} baseline */
export function validateBaseline(baseline,file,source,server){
 const identity=sourceIdentity(source),name=path.basename(file);
 const whole=baseline?.kind==='author-baseline'&&baseline.schema===1&&/^[A-Za-z0-9]{6,12}$/.test(
  baseline.id??'')&&Number.isSafeInteger(baseline.version)&&baseline.version>=1&&
  /^[a-f0-9]{64}$/.test(baseline.state??'')&&Array.isArray(baseline.dependencyReceipts)&&
  Array.isArray(baseline.retainedBackends);
 // Name the real cause: most often the file was overwritten and lost its authoring marker.
 const cause=!whole?`${name}.af.json is not a readable companion`:baseline.server!==serverOrigin(
  server)?`${name}.af.json belongs to another server`:baseline.sourceFile!==name?
  `${name}.af.json belongs to ${baseline.sourceFile} (renamed or copied)`:baseline.historical?
  `${name} was read from saved version ${baseline.version}`:identity?.server!==baseline.server||
  identity?.id!==baseline.id||identity?.pair!==baseline.pair?`${name} was overwritten after it `+
  `was saved (its af-authoring marker no longer matches ${name}.af.json)`:null;
 if(cause)throw new ToolError('invalid_baseline',cause+', so publish cannot tell what it '+
  'replaces.',2,pairRecovery(name,whole?baseline.id:'ID'));
const paths=new Set();for(const receipt of baseline.dependencyReceipts){if(!receipt||
   typeof receipt.path!=='string'||receipt.path.startsWith('/')||receipt.path.split('/').some(part=>
   part==='..'||!part)||receipt.path.includes('\\')||paths.has(receipt.path)||!['asset',
   'dataset'].includes(receipt.kind)||!/^[A-Za-z0-9]{6,12}$/.test(receipt.id??'')||!/^\d+$/.test(
   receipt.revision??''))throw new ToolError('invalid_dependency_receipts',
   'Baseline dependency receipts are inconsistent.',2);paths.add(receipt.path);}
 return baseline;
}
/** Recoverable pair: interrupted writes leave no valid baseline (pair IDs differ). `replace` is
 * only for publish's own unchanged input; never overwrite an author edit. */
export async function saveAuthoringPair({record,server,output,root,entryPath,receipts,
  localReferences=false,historical=false,replace=false,backendLinks=[]}){
if(typeof record.html!=='string')throw new ToolError('not_html','This record is not editable HTML.',
   2);
const shared=await platform(),pair=randomUUID();root=path.resolve(root??path.dirname(output));
   entryPath=entryPath??path.relative(root,output).split(path.sep).join('/');
 const dependencies=receipts??record.dependencyReceipts??[];
let source=localReferences?shared.authoringHtml(record.html,{server,pageId:record.id,entryPath,
   receipts:dependencies}):record.html;
 source=stampSource(restoreBackendHrefs(source,backendLinks),{server,id:record.id,pair});
const baseline={kind:'author-baseline',schema:1,server,id:record.id,version:record.version,state:
   record.state,format:'html',sourceFile:path.basename(output),pair,historical,root,entryPath,
   sha256:hash(source),...(Number.isSafeInteger(record.sharing_revision)?{sharingRevision:
   record.sharing_revision}:{}),
   dependencyReceipts:dependencies,retainedBackends:shared.previewBackendLinks(source)};
 const companion=output+'.af.json';
if(replace){await shared.atomicWrite(output,source);await shared.atomicWrite(companion,
   JSON.stringify(baseline,null,2)+'\n');return {source:path.resolve(output),baseline:path.resolve(
   companion),id:record.id,version:record.version};}
if(await optionalFile(output)||await optionalFile(companion))throw new ToolError('output_exists',
   'Authoring output or companion already exists.',2,
   'Choose a new --output path; existing files are retained.');
 await exclusive(output,source);
try{await exclusive(companion,JSON.stringify(baseline,null,2)+'\n');}catch(error){
   throw new ToolError('incomplete_pair',
   'Source saved but companion failed; this source cannot be published as an update.',1,
   'Read again to a fresh output path; retain source for recovery.',{source:output});}
return {source:path.resolve(output),baseline:path.resolve(companion),id:record.id,version:
   record.version};
}
export async function loadPair(file,server){
 const source=await readFile(file,'utf8'),bytes=await optionalFile(file+'.af.json');
if(!bytes)return {source,baseline:null};
let baseline=null;try{baseline=JSON.parse(bytes);}catch{}
 return {source,baseline:validateBaseline(baseline,file,source,server)};
}
/** Where read --output FILE saves: FILE itself while it is new or still exactly what its companion
 * recorded (refreshed in place), else a FILE.fresh sibling, with a note saying so. */
export async function readTarget(file){
 const bytes=await optionalFile(file),saved=await optionalFile(file+'.af.json').then(b=>
  b&&JSON.parse(b)).catch(()=>null);
 if(!bytes||saved?.sha256===hash(bytes))return {output:file,replace:Boolean(bytes||saved)};
 const extension=path.extname(file),stem=file.slice(0,file.length-extension.length);
 for(let n=1;;n++){const output=`${stem}.fresh${n>1?'-'+n:''}${extension}`;
  if(!await optionalFile(output)&&!await optionalFile(output+'.af.json'))return {output,replace:
   false,note:`${path.basename(file)} has changes of its own since it was read, so this read went `+
   `to ${path.basename(output)}: reapply what you need there, then publish that file.`};}
}
