import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createRuntimeAssetRetention} from '../asset-retention';
import type {RuntimeAssetStore} from '../asset-retention-contract';
const hash=(source:string)=>createHash('sha256').update(source).digest('hex');
const assets=(apollo:string)=>({core:`reader for ${hash(apollo)}`,apollo,apolloPath:`/af/v1/apollo/${hash(apollo)}`,reader:`reader:${apollo}`,readerPath:`/af/v1/reader/${hash(`reader:${apollo}`)}`});
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
it('does not expose either module before durable writes and retries failures',async()=>{
 const current=assets('current');let fail=true;
 const releases:Array<()=>void>=[],stored=new Set<string>();
 const store:RuntimeAssetStore={get:async()=>null,put:async(digest)=>{if(fail)throw Error('unavailable');await new Promise<void>(resolve=>{releases.push(resolve);});stored.add(digest);}};
 const retention=createRuntimeAssetRetention(current,store,hash);
 await expect(retention.expose()).rejects.toThrow('unavailable');fail=false;
 let exposed=false;const a=retention.expose().then(()=>{exposed=true;}),b=retention.expose();await Promise.resolve();
 expect(exposed).toBe(false);releases[0]!();await Promise.resolve();expect(exposed).toBe(false);
 releases[1]!();await Promise.all([a,b]);
 expect(stored).toEqual(new Set([hash(current.apollo),hash(current.reader)]));
 expect(await retention.expose()).toEqual(current);
});
it('retains reader bytes across releases with exact digest validation',async()=>{
 const {store}=memory(),first=assets('first'),second=assets('second');
 await createRuntimeAssetRetention(first,store,hash).expose();
 const release=createRuntimeAssetRetention(second,store,hash);await release.expose();
 expect(await release.read(hash(first.reader))).toBe(first.reader);
 expect(await release.read(hash(second.reader))).toBe(second.reader);
});
