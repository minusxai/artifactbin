import path from 'node:path';
import {readFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {ToolError,hash,platform,exclusive,jsonFile,optionalFile,serverOrigin} from './toolbox-client.mjs';
const marker=/<!-- af-authoring:([A-Za-z0-9_-]+) -->/g;
export function sourceIdentity(source){const all=[...source.matchAll(marker)];if(all.length>1)throw new ToolError('ambiguous_identity','Source has multiple authoring identities.',2);if(!all.length)return null;try{return JSON.parse(Buffer.from(all[0][1],'base64url').toString());}catch{throw new ToolError('invalid_identity','Source identity is malformed.',2);}}
export function stampSource(source,identity){return source.replace(marker,'')+'\n<!-- af-authoring:'+Buffer.from(JSON.stringify(identity)).toString('base64url')+' -->\n';}
/** @param {import('../../../lib/skills/author-toolbox-contract').AuthorBaseline} baseline */
export function validateBaseline(baseline,file,source,server){
 const identity=sourceIdentity(source);
 if(baseline?.kind!=='author-baseline'||baseline.schema!==1||baseline.server!==serverOrigin(server)||!/^[A-Za-z0-9]{6,12}$/.test(baseline.id??'')||!Number.isSafeInteger(baseline.version)||baseline.version<1||!/^[a-f0-9]{64}$/.test(baseline.state??'')||baseline.sourceFile!==path.basename(file)||baseline.historical||!Array.isArray(baseline.dependencyReceipts)||!Array.isArray(baseline.retainedBackends)||identity?.server!==baseline.server||identity?.id!==baseline.id||identity?.pair!==baseline.pair)throw new ToolError('invalid_baseline','Source and current-head companion baseline must be a complete matching pair.',2,'Read a current canonical pair, reconcile edits, then publish; never attach a fresh head to stale bytes.');
 const paths=new Set();for(const receipt of baseline.dependencyReceipts){if(!receipt||typeof receipt.path!=='string'||receipt.path.startsWith('/')||receipt.path.split('/').some(part=>part==='..'||!part)||receipt.path.includes('\\')||paths.has(receipt.path)||!['asset','dataset'].includes(receipt.kind)||!/^[A-Za-z0-9]{6,12}$/.test(receipt.id??'')||!/^\d+$/.test(receipt.revision??''))throw new ToolError('invalid_dependency_receipts','Baseline dependency receipts are inconsistent.',2);paths.add(receipt.path);}
 return baseline;
}
/** Exclusive recoverable pair: interrupted writes leave no valid baseline. Never overwrite an author edit. */
export async function saveAuthoringPair({record,server,output,root,entryPath,receipts,localReferences=false,historical=false}){
 if(typeof record.html!=='string')throw new ToolError('not_html','This record is not editable HTML.',2);
 const shared=await platform(),pair=randomUUID();root=path.resolve(root??path.dirname(output));entryPath=entryPath??path.relative(root,output).split(path.sep).join('/');
 const dependencies=receipts??record.dependencyReceipts??[];
 let source=localReferences?shared.authoringHtml(record.html,{server,pageId:record.id,entryPath,receipts:dependencies}):record.html;
 source=stampSource(source,{server,id:record.id,pair});
 const baseline={kind:'author-baseline',schema:1,server,id:record.id,version:record.version,state:record.state,format:'html',sourceFile:path.basename(output),pair,historical,root,entryPath,dependencyReceipts:dependencies,retainedBackends:shared.previewBackendLinks(source)};
 const companion=output+'.af.json';
 if(await optionalFile(output)||await optionalFile(companion))throw new ToolError('output_exists','Authoring output or companion already exists.',2,'Choose a new --output path; existing files are retained.');
 await exclusive(output,source);
 try{await exclusive(companion,JSON.stringify(baseline,null,2)+'\n');}catch(error){throw new ToolError('incomplete_pair','Source saved but companion failed; this source cannot be published as an update.',1,'Read again to a fresh output path; retain source for recovery.',{source:output});}
 return {source:path.resolve(output),baseline:path.resolve(companion),id:record.id,version:record.version};
}
export async function loadPair(file,server,explicit){
 const source=await readFile(file,'utf8'),bytes=await optionalFile(explicit??file+'.af.json');
 if(!bytes){if(sourceIdentity(source))throw new ToolError('baseline_missing','Linked source is missing its companion baseline.',2);return {source,baseline:null};}
 let baseline;try{baseline=JSON.parse(bytes);}catch{throw new ToolError('invalid_baseline','Companion baseline is not valid JSON.',2);}
 return {source,baseline:validateBaseline(baseline,file,source,server)};
}
