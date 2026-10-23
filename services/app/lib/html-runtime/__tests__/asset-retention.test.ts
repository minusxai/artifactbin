import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createRuntimeAssetRetention} from '../asset-retention';
import type {RuntimeAssetStore} from '../asset-retention-contract';
const hash=(source:string)=>createHash('sha256').update(source).digest('hex');
const assets=(apollo:string)=>({core:`reader for ${hash(apollo)}`,apollo,apolloPath:`/af/v1/apollo/${hash(apollo)}`});
function memory(){const values=new Map<string,string>();return {values,store:{get:async digest=>values.get(digest)??null,put:async(digest,source)=>{values.set(digest,source);}} satisfies RuntimeAssetStore};}
it('a second release serves exact retained bytes referenced by an already-open reader',async()=>{
 const {store}=memory(),first=assets('export const release=1'),second=assets('export const release=2');
 await createRuntimeAssetRetention(first,store,hash).expose();
 const deployed=createRuntimeAssetRetention(second,store,hash);await deployed.expose();
 expect(await deployed.read(hash(first.apollo))).toBe(first.apollo);
 expect(await deployed.read(hash(second.apollo))).toBe(second.apollo);
});
it('never serves missing, malformed or tampered objects as executable code',async()=>{
 const {store,values}=memory(),current=assets('current'),retention=createRuntimeAssetRetention(current,store,hash);
 values.set(hash('old'),'tampered');
 expect(await retention.read(hash('old'))).toBeNull();expect(await retention.read(hash('missing'))).toBeNull();expect(await retention.read('../private')).toBeNull();
 const invalid={...current,apolloPath:'/af/v1/apollo/'+hash('different')};
 await expect(createRuntimeAssetRetention(invalid,store,hash).expose()).rejects.toThrow();
 expect(values.has(hash(current.apollo))).toBe(false);
});
it('does not expose a path before durable write and retries failed writes without marking them persisted',async()=>{
 const current=assets('current');let writes=0,release:()=>void=()=>{};
 const store:RuntimeAssetStore={get:async()=>null,put:async()=>{writes++;if(writes===1)throw Error('unavailable');await new Promise<void>(resolve=>{release=resolve;});}};
 const retention=createRuntimeAssetRetention(current,store,hash);
 await expect(retention.expose()).rejects.toThrow('unavailable');
 let exposed=false;const a=retention.expose().then(()=>{exposed=true;}),b=retention.expose();await Promise.resolve();
 expect(exposed).toBe(false);expect(writes).toBe(2);release();await Promise.all([a,b]);
 expect(await retention.expose()).toEqual(current);expect(writes).toBe(2);
});
