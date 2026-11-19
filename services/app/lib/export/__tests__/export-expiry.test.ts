/**
 * Export image expiry (export-expiry-contract.ts) on the app's filesystem store; export-expiry-s3.test.ts runs it on S3.
 * The store's first write is slow, as a fresh S3-compatible server's is (it grows the bucket's volumes first), so the
 * fast lane catches a suite that bounds a store write by a short wait, which only failed on S3 after merge.
 */
import {useAppHarness} from '@/__tests__/harness';
import {objectStore,type ObjectStore} from '@/lib/object-store';
import {exportExpirySuite} from './export-expiry-contract';

const COLD_WRITE_MS=750;
let cold=true;
const coldFirstWrite=(store:ObjectStore):ObjectStore=>Object.create(store,{put:{value:async(...args:Parameters<ObjectStore['put']>)=>{
 if(cold){cold=false;await new Promise(r=>setTimeout(r,COLD_WRITE_MS));}
 return store.put(...args);
}}});

useAppHarness();
exportExpirySuite('filesystem',async()=>coldFirstWrite(objectStore()));
