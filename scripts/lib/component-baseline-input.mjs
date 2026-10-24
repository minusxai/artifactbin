import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {verifyComponentAssetArchive} from '../lib/component-asset-proof.mjs';
import {installedFiles} from '../fixtures/component-baseline/publication.mjs';
import {baselineLocalOrigin} from './component-baseline-session.mjs';

/** Add source-verified archive evidence to an imported reader manifest without republishing its entries. */
export async function attachVerifiedComponentAssets(input,{source,base,fetcher=fetch}){
 if(input.implementation!=='html')return input;
 const origin=baselineLocalOrigin(base);
 const response=await fetcher(origin+'/skills/artifactbin.zip');
 if(!response.ok)throw Error(`Candidate skill archive unavailable (${response.status})`);
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>128*1024*1024)throw Error('Candidate skill archive limit exceeded');
 const componentAssets=await verifyComponentAssetArchive({root:path.resolve(source),files:installedFiles(bytes)});
 if(input.componentAssets&&JSON.stringify(input.componentAssets)!==JSON.stringify(componentAssets))throw Error('Imported component evidence differs from the verified source build');
 return {...input,componentAssets};
}

/** Persist the source-bound archive proof before capture begins.
 * @param {{implementation:string,sourceRevision:string,componentAssets?:unknown,output:string}} input
 */
export async function writeBaselineComponentAssets(input){
 if(!input.componentAssets)return;
 await mkdir(input.output,{recursive:true});
 await writeFile(path.join(input.output,'component-assets.json'),JSON.stringify({implementation:input.implementation,sourceRevision:input.sourceRevision,componentAssets:input.componentAssets},null,2));
}
