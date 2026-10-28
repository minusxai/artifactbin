import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {hostedComponentFiles,verifyComponentAssetArchive} from '../lib/component-asset-proof.mjs';
import {baselineLocalOrigin} from './component-baseline-session.mjs';

/** Add source-verified hosted component evidence to an imported reader manifest without republishing its entries. */
export async function attachVerifiedComponentAssets(input,{source,base,fetcher=fetch}){
 if(input.implementation!=='html')return input;
 const origin=baselineLocalOrigin(base);
 const componentAssets=await verifyComponentAssetArchive({root:path.resolve(source),files:await hostedComponentFiles({root:path.resolve(source),origin,fetcher})});
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
