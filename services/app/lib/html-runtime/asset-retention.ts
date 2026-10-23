import type {HtmlRuntimeAssets} from './contract';
import type {RuntimeAssetRetention,RuntimeAssetStore} from './asset-retention-contract';
/** Release-independent public code, verified by its requested content address. */
export function createRuntimeAssetRetention(current:HtmlRuntimeAssets,store:RuntimeAssetStore,hash:(source:string)=>string):RuntimeAssetRetention {
 let persisted:Promise<HtmlRuntimeAssets>|undefined;
 const digest=hash(current.apollo);
 const expose=()=>persisted??=(async()=>{
  if(current.apolloPath!==`/af/v1/apollo/${digest}`)throw Error('Runtime asset digest mismatch');
  await store.put(digest,current.apollo);
  return current;
 })().catch(error=>{persisted=undefined;throw error;});
 return {expose,async read(requested){
  if(!/^[a-f0-9]{64}$/.test(requested))return null;
  if(requested===digest){await expose();return current.apollo;}
  const source=await store.get(requested);
  return source!==null&&hash(source)===requested?source:null;
 }};
}
