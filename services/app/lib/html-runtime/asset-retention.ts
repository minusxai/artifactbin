import type {RuntimeAssetStore,SourceRetention} from './asset-retention-contract';
/** Durable public sources used by the supported pinned host/component/style manifest. */
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
