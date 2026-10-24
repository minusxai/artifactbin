import type {HtmlRuntimeAssets} from './contract';
import type {RuntimeAssetRetention,RuntimeAssetStore} from './asset-retention-contract';
/** Release-independent public code, verified by its requested content address. */
export function createRuntimeAssetRetention(current:HtmlRuntimeAssets,store:RuntimeAssetStore,hash:(source:string)=>string):RuntimeAssetRetention {
 let persisted:Promise<HtmlRuntimeAssets>|undefined;
 const modules=[{source:current.apollo,path:current.apolloPath,prefix:'apollo'},{source:current.reader,path:current.readerPath,prefix:'reader'},...(current.chrome&&current.chromePath?[{source:current.chrome,path:current.chromePath,prefix:'reader'}]:[])].map(module=>({...module,digest:hash(module.source)}));
 const expose=()=>persisted??=(async()=>{
  for(const module of modules)if(module.path!==`/af/v1/${module.prefix}/${module.digest}`)throw Error('Runtime asset digest mismatch');
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
