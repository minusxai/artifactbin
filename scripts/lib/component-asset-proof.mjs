/** Source-bound build receipt used by the capture harness before publication.
 * @typedef {{format:'component-assets-v1',inputs:readonly {path:string,sha256:string}[],outputs:readonly {path:string,sha256:string}[]}} ComponentAssetReceipt
 */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const COMPONENT_RECEIPT='services/app/lib/build-assets/html-components-receipt.json';
/** @param {{root:string,inputs:readonly string[],outputs:readonly string[],receiptPath?:string}} options */
export async function writeComponentAssetReceipt({root,inputs,outputs,receiptPath=COMPONENT_RECEIPT}){
 const entries=async names=>Promise.all([...new Set(names)].sort().map(async name=>({path:path.relative(root,path.resolve(root,name)),sha256:sha(await readFile(path.resolve(root,name)))})));
 const receipt={format:'component-assets-v1',inputs:await entries(inputs),outputs:await entries(outputs)};
 if([...receipt.inputs,...receipt.outputs].some(x=>x.path.startsWith('../')||path.isAbsolute(x.path)))throw Error('Component receipt input outside source root');
 await mkdir(path.dirname(path.resolve(root,receiptPath)),{recursive:true});await writeFile(path.resolve(root,receiptPath),JSON.stringify(receipt,null,2));return receipt;
}
const BUILT='services/app/lib/build-assets/';
const readReceipt=async(root,receiptPath)=>JSON.parse(await readFile(path.resolve(root,receiptPath),'utf8').catch(error=>{if(error.code==='ENOENT')throw Error('Missing component build proof');throw error;}));
/** `components/<file>` names of the compiled hosted modules the receipt lists. */
const builtModuleNames=receipt=>(receipt.outputs??[]).map(entry=>entry.path).filter(name=>typeof name==='string'&&name.startsWith(BUILT+'components/')&&name.endsWith('.js')).map(name=>name.slice(BUILT.length));
/** The hosted component modules the receipt names, as `origin` serves them (`/af/components/<file>`), keyed `components/<file>`.
 * @param {{root:string,origin:string,fetcher?:typeof fetch,receiptPath?:string}} options */
export async function hostedComponentFiles({root,origin,fetcher=fetch,receiptPath=COMPONENT_RECEIPT}){
 const files=new Map();
 for(const name of builtModuleNames(await readReceipt(root,receiptPath))){
  const response=await fetcher(new URL('/af/'+name,origin));
  if(!response.ok)throw Error(`Hosted component unavailable (${response.status}): ${name}`);
  files.set(name,new Uint8Array(await response.arrayBuffer()));
 }
 return files;
}
/** The same receipt-listed modules read from the local build output (what this checkout would serve), keyed `components/<file>`.
 * A missing file reads as a stale build so callers can rebuild.
 * @param {{root:string,receiptPath?:string}} options */
export async function builtComponentFiles({root,receiptPath=COMPONENT_RECEIPT}){
 const files=new Map();
 for(const name of builtModuleNames(await readReceipt(root,receiptPath)))files.set(name,await readFile(path.resolve(root,BUILT+name)).catch(error=>{if(error.code==='ENOENT')throw Error('Stale component build: '+BUILT+name);throw error;}));
 return files;
}
/** Reject a source-stale cache or hosted component modules different from the built bytes.
 * @param {{root:string,files:ReadonlyMap<string,Uint8Array>,receiptPath?:string}} options
 */
export async function verifyComponentAssetArchive({root,files,receiptPath=COMPONENT_RECEIPT}){
 // A checkout that never ran the component build has no receipt: the same missing proof, not a raw ENOENT.
 const receipt=await readReceipt(root,receiptPath);
 if(receipt.format!=='component-assets-v1'||!receipt.inputs?.length||!receipt.outputs?.length)throw Error('Missing component build proof');
 for(const entry of [...receipt.inputs,...receipt.outputs]){
  if(typeof entry.path!=='string'||entry.path.startsWith('../')||path.isAbsolute(entry.path)||entry.path.includes('\\')||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid component build proof');
  if(sha(await readFile(path.resolve(root,entry.path)).catch(error=>{if(error.code==='ENOENT')throw Error('Stale component build: '+entry.path);throw error;}))!==entry.sha256)throw Error('Stale component build: '+entry.path);
 }
 const prefix=BUILT,expected=receipt.outputs.filter(x=>x.path.startsWith(prefix+'components/')&&x.path.endsWith('.js'));
 const actual=[...files.keys()].filter(x=>/^components\/.+\.js$/.test(x)).sort();
 if(!expected.length||JSON.stringify(expected.map(x=>x.path.slice(prefix.length)).sort())!==JSON.stringify(actual))throw Error('Served component module closure differs from build');
 for(const entry of expected)if(sha(files.get(entry.path.slice(prefix.length)))!==entry.sha256)throw Error('Served component bytes differ from build: '+entry.path);
 return {format:receipt.format,receiptSha256:sha(JSON.stringify(receipt)),inputs:receipt.inputs,modules:expected.map(x=>({path:x.path.slice(prefix.length),sha256:x.sha256}))};
}
