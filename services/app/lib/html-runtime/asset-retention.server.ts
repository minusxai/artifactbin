import {objectStore,ObjectUnavailable} from '@/lib/object-store';
import type {RuntimeAssetStore} from './asset-retention-contract';
/** A separate public-code namespace per kind (`html-runtime/<kind>/<digest>`); no artifact key, page state or credential is accepted. */
export function retainedPublicAssets(kind:'apollo'|'components'|'styles'|'host',contentType:string):RuntimeAssetStore {
 const key=(digest:string)=>`html-runtime/${kind}/${digest}`;
 return {
  async get(digest){
   try{return (await objectStore().get(key(digest))).toString('utf8');}
   catch(error){if(error instanceof ObjectUnavailable)return null;throw error;}
  },
  async put(digest,source){await objectStore().put(key(digest),source,contentType);}
 };
}
export const retainedRuntimeAssets:RuntimeAssetStore=retainedPublicAssets('apollo','application/javascript; charset=utf-8');
