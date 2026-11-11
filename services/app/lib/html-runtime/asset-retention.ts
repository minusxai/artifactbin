import type {HtmlRuntimeAssets} from './contract';
import type {RuntimeAssetRetention,RuntimeAssetStore,SourceRetention} from './asset-retention-contract';
/**
 * Release-independent public code behind content addresses. Pages opened before a deploy carry import maps naming
 * the pre-D17 digests (/af/v1/apollo|reader/<sha256>); host pages name the pinned files the manifest lists
 * (lib/document-serving/hosted-blocks). The store keeps serving either the exact bytes. Current pages use the flat
 * /af/*.js addresses (contract RUNTIME_MODULE_PATHS); the current build is stored too, so every alias answers from
 * one place.
 */
export function createSourceRetention(sources:readonly string[],store:RuntimeAssetStore,hash:(source:string)=>string):SourceRetention {
 let persisted:Promise<void>|undefined;
 const modules=sources.map(source=>({source,digest:hash(source)}));
 const expose=()=>persisted??=Promise.all(modules.map(module=>store.put(module.digest,module.source))).then(()=>undefined).catch(error=>{persisted=undefined;throw error;});
 return {digests:modules.map(module=>module.digest),expose,async read(requested){
  if(!/^[a-f0-9]{64}$/.test(requested))return null;
  const currentModule=modules.find(module=>requested===module.digest);
  if(currentModule){await expose();return currentModule.source;}
  const source=await store.get(requested);
  return source!==null&&hash(source)===requested?source:null;
 }};
}
export function createRuntimeAssetRetention(current:HtmlRuntimeAssets,store:RuntimeAssetStore,hash:(source:string)=>string):RuntimeAssetRetention {
 const retention=createSourceRetention([current.portableEngine,current.apollo,current.reader,current.chrome,current.morph].filter((source):source is string=>!!source),store,hash);
 return {expose:()=>retention.expose().then(()=>current),read:retention.read};
}
