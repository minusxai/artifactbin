/** The hosted component doors: their `@afbin/` names, addresses, the hosted-name check and the file loader. */
import {readdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {COMPONENTS_PATH,LIBRARY_SPECIFIER_PREFIX,componentImports,componentUrl,isHostedComponent} from '../index';
import {COMPONENT_CHUNK,loadComponentFile} from '../server';
import hosted from '../../html-components/hosted.json';

it('names components under one prefix at one unversioned path',()=>{
 expect(LIBRARY_SPECIFIER_PREFIX).toBe('@afbin/');
 expect(COMPONENTS_PATH).toBe('/af/components/');
 expect(componentUrl('button')).toBe('/af/components/button.js');
 expect(componentUrl('button','https://app.test')).toBe('https://app.test/af/components/button.js');
 expect(componentImports('https://app.test')[`${LIBRARY_SPECIFIER_PREFIX}button`]).toBe(componentUrl('button','https://app.test'));
});

it('hosts the listed components and the legacy wrappers, and nothing else',()=>{
 for(const name of [...hosted.components,...hosted.legacy])expect(isHostedComponent(name),name).toBe(true);
 for(const name of ['','Button','button.js','../button','vega','constructor','__proto__','chunk-abc'])expect(isHostedComponent(name),name).toBe(false);
});

it('recognizes only content-addressed chunk names',()=>{
 expect(COMPONENT_CHUNK.test('chunk-aken6ucf.js')).toBe(true);
 for(const name of ['chunk-.js','chunk-ABC.js','chunk-abc.js.map','../chunk-abc.js','chunk-abc.mjs','xchunk-abc.js'])expect(COMPONENT_CHUNK.test(name),name).toBe(false);
});

it('loads a hosted entry and a chunk with a strong etag and brotli twin, once per unchanged file',async()=>{
 const entry=await loadComponentFile('button.js');
 expect(entry).not.toBeNull();
 expect(entry!.etag).toMatch(/^"[0-9a-f]{64}"$/);
 expect(brotliDecompressSync(entry!.br).equals(entry!.body)).toBe(true);
 expect(await loadComponentFile('button.js')).toBe(entry);
 const chunk=readdirSync(path.resolve('lib/build-assets/components')).find(name=>COMPONENT_CHUNK.test(name))!;
 expect((await loadComponentFile(chunk))?.body.byteLength).toBeGreaterThan(0);
});

it('reads no file for an unhosted, traversal or missing name, even one present in the build directory',async()=>{
 for(const name of ['vega.js','../index.js','button','Button.js','button.js/../../registry.json','chunk-zzzzzzzz.js'])expect(await loadComponentFile(name),name).toBeNull();
 const stray=path.resolve('lib/build-assets/components/not-hosted.js');
 writeFileSync(stray,'export const leaked=true;');
 try{expect(await loadComponentFile('not-hosted.js')).toBeNull();}finally{rmSync(stray,{force:true});}
});
