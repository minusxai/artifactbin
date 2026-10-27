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
/** Reject a source-stale cache or a served archive different from the built bytes.
 * @param {{root:string,files:ReadonlyMap<string,Uint8Array>,receiptPath?:string}} options
 */
export async function verifyComponentAssetArchive({root,files,receiptPath=COMPONENT_RECEIPT}){
 // A checkout that never ran the component build has no receipt: the same missing proof, not a raw ENOENT.
 const receipt=JSON.parse(await readFile(path.resolve(root,receiptPath),'utf8').catch(error=>{if(error.code==='ENOENT')throw Error('Missing component build proof');throw error;}));
 if(receipt.format!=='component-assets-v1'||!receipt.inputs?.length||!receipt.outputs?.length)throw Error('Missing component build proof');
 for(const entry of [...receipt.inputs,...receipt.outputs]){
  if(typeof entry.path!=='string'||entry.path.startsWith('../')||path.isAbsolute(entry.path)||entry.path.includes('\\')||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid component build proof');
  if(sha(await readFile(path.resolve(root,entry.path)))!==entry.sha256)throw Error('Stale component build: '+entry.path);
 }
 const prefix='services/app/skills/artifactbin/';const expected=receipt.outputs.filter(x=>x.path.startsWith(prefix+'components/')&&x.path.endsWith('.js'));
 const actual=[...files.keys()].filter(x=>/^components\/.+\.js$/.test(x)).sort();
 if(!expected.length||JSON.stringify(expected.map(x=>x.path.slice(prefix.length)).sort())!==JSON.stringify(actual))throw Error('Served component module closure differs from build');
 for(const entry of expected)if(sha(files.get(entry.path.slice(prefix.length)))!==entry.sha256)throw Error('Served component bytes differ from build: '+entry.path);
 return {format:receipt.format,receiptSha256:sha(JSON.stringify(receipt)),inputs:receipt.inputs,modules:expected.map(x=>({path:x.path.slice(prefix.length),sha256:x.sha256}))};
}
