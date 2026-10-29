/** The server entry's retained runtime store: the object store under its own public-code namespace. */
import {createHash, randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {objectStore} from '@/lib/object-store';
import {createRuntimeAssetRetention,retainedRuntimeAssets} from '../server';

const hash=(source:string)=>createHash('sha256').update(source).digest('hex');

it('stores runtime code under html-runtime/apollo and answers null for a digest never stored',async()=>{
 const source=`export const release="${randomUUID()}";// ☕`;
 expect(await retainedRuntimeAssets.get(hash(source))).toBeNull();
 await retainedRuntimeAssets.put(hash(source),source);
 expect(await retainedRuntimeAssets.get(hash(source))).toBe(source);
 expect((await objectStore().get(`html-runtime/apollo/${hash(source)}`)).toString('utf8')).toBe(source);
});

it('serves a previous release the retention exposed through the real store',async()=>{
 const release=(n:string)=>({core:'core',apollo:`export const release="${n}";`,apolloPath:'/af/apollo.js',reader:'reader',readerPath:'/af/reader.js'});
 const first=release(randomUUID()),second=release(randomUUID());
 await createRuntimeAssetRetention(first,retainedRuntimeAssets,hash).expose();
 const deployed=createRuntimeAssetRetention(second,retainedRuntimeAssets,hash);
 await deployed.expose();
 expect(await deployed.read(hash(first.apollo))).toBe(first.apollo);
 expect(await deployed.read(hash('never stored'))).toBeNull();
});
