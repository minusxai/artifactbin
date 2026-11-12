/** Supported pinned host assets use a separate public-code object namespace. */
import {createHash, randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {objectStore} from '@/lib/object-store';
import {createSourceRetention,retainedPublicAssets} from '../server';

const store=retainedPublicAssets('host','application/javascript; charset=utf-8');
const hash=(source:string)=>createHash('sha256').update(source).digest('hex');
it('stores host code under html-runtime/host without touching retired runtime objects',async()=>{
 const source=`export const release="${randomUUID()}";// ☕`;
 expect(await store.get(hash(source))).toBeNull();
 await store.put(hash(source),source);
 expect(await store.get(hash(source))).toBe(source);
 expect((await objectStore().get(`html-runtime/host/${hash(source)}`)).toString('utf8')).toBe(source);
});
it('serves a previous pinned host release through the real store',async()=>{
 const first=[`export const release="${randomUUID()}";`],second=[`export const release="${randomUUID()}";`];
 await createSourceRetention(first,store,hash).expose();
 const deployed=createSourceRetention(second,store,hash);
 await deployed.expose();
 expect(await deployed.read(hash(first[0]!))).toBe(first[0]!);
 expect(await deployed.read(hash('never stored'))).toBeNull();
});
