import {objectStore,ObjectUnavailable} from '@/lib/object-store';
import type {RuntimeAssetStore} from './asset-retention-contract';
/** Separate public-code namespace; no artifact key, page state or credential is accepted. */
const key=(digest:string)=>`html-runtime/apollo/${digest}`;
export const retainedRuntimeAssets:RuntimeAssetStore={
 async get(digest){
  try{return (await objectStore().get(key(digest))).toString('utf8');}
  catch(error){if(error instanceof ObjectUnavailable)return null;throw error;}
 },
 async put(digest,source){await objectStore().put(key(digest),source,'application/javascript; charset=utf-8');}
};
