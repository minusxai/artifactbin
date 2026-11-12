import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createSourceRetention} from '../asset-retention';
import type {RuntimeAssetStore} from '../asset-retention-contract';
const hash=(source:string)=>createHash('sha256').update(source).digest('hex');
const assets=(host:string)=>[host,`comments:${host}`];
function memory(){const values=new Map<string,string>();return {values,store:{get:async digest=>values.get(digest)??null,put:async(digest,source)=>{values.set(digest,source);}} satisfies RuntimeAssetStore};}
it('a second release serves exact retained bytes referenced by a pinned host',async()=>{
 const {store}=memory(),first=assets('export const release=1'),second=assets('export const release=2');
 await createSourceRetention(first,store,hash).expose();
 const deployed=createSourceRetention(second,store,hash);await deployed.expose();
 expect(await deployed.read(hash(first[0]!))).toBe(first[0]!);
 expect(await deployed.read(hash(second[0]!))).toBe(second[0]!);
});
it('never serves missing, malformed or tampered objects as executable code',async()=>{
 const {store,values}=memory(),current=assets('current'),retention=createSourceRetention(current,store,hash);
 values.set(hash('old'),'tampered');
 expect(await retention.read(hash('old'))).toBeNull();expect(await retention.read(hash('missing'))).toBeNull();expect(await retention.read('../private')).toBeNull();
});
it('does not expose either module before durable writes and retries failures',async()=>{
 const current=assets('current');let fail=true;
 const releases:Array<()=>void>=[],stored=new Set<string>();
 const store:RuntimeAssetStore={get:async()=>null,put:async(digest)=>{if(fail)throw Error('unavailable');await new Promise<void>(resolve=>{releases.push(resolve);});stored.add(digest);}};
 const retention=createSourceRetention(current,store,hash);
 await expect(retention.expose()).rejects.toThrow('unavailable');fail=false;
 let exposed=false;const a=retention.expose().then(()=>{exposed=true;}),b=retention.expose();await Promise.resolve();
 expect(exposed).toBe(false);releases[0]!();await Promise.resolve();expect(exposed).toBe(false);
 releases[1]!();await Promise.all([a,b]);
 expect(stored).toEqual(new Set([hash(current[0]!),hash(current[1]!)]));
 expect(await retention.expose()).toBeUndefined();
});
it('retains host comments bytes across releases with exact digest validation',async()=>{
 const {store}=memory(),first=assets('first'),second=assets('second');
 await createSourceRetention(first,store,hash).expose();
 const release=createSourceRetention(second,store,hash);await release.expose();
 expect(await release.read(hash(first[1]!))).toBe(first[1]!);
 expect(await release.read(hash(second[1]!))).toBe(second[1]!);
});
