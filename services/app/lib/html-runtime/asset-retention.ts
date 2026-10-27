import type {HtmlRuntimeAssets} from './contract';
import type {RuntimeAssetRetention,RuntimeAssetStore} from './asset-retention-contract';
/**
 * Release-independent public code behind the pre-D17 content addresses (/af/v1/apollo|reader/<sha256>). Pages opened
 * before a deploy carry import maps naming those digests; the store keeps serving them the exact bytes. Current pages
 * use the flat /af/*.js addresses (contract RUNTIME_MODULE_PATHS); the current build is stored too, so every /af/v1 alias
 * answers from one place.
 */
export function createRuntimeAssetRetention(current:HtmlRuntimeAssets,store:RuntimeAssetStore,hash:(source:string)=>string):RuntimeAssetRetention {
 let persisted:Promise<HtmlRuntimeAssets>|undefined;
 const modules=[current.portableEngine,current.apollo,current.reader,current.chrome,current.morph].filter((source):source is string=>!!source).map(source=>({source,digest:hash(source)}));
 const expose=()=>persisted??=(async()=>{
  await Promise.all(modules.map(module=>store.put(module.digest,module.source)));
  return current;
 })().catch(error=>{persisted=undefined;throw error;});
 return {expose,async read(requested){
  if(!/^[a-f0-9]{64}$/.test(requested))return null;
  const currentModule=modules.find(module=>requested===module.digest);
  if(currentModule){await expose();return currentModule.source;}
  const source=await store.get(requested);
  return source!==null&&hash(source)===requested?source:null;
 }};
}
