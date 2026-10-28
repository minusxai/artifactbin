import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {GET as component} from '@/app/af/components/[file]/route';
import {GET as styles} from '@/app/af/styles.css/route';
import {referencedLibraryResources} from '../assets.server';
import {packOfflineDependencies} from '../../offline-dependencies';
import {markupCsp} from '../../page-styles/markup-csp';
import hosted from '../../html-components/hosted.json';

const get=(file:string,headers:Record<string,string>={})=>component(new Request('https://app.example/af/components/'+file,{headers}),{params:Promise.resolve({file})});
const built=(file:string)=>readFileSync(path.resolve('lib/build-assets/components',file));
const chunks=(source:string)=>[...source.matchAll(/["']\.\/(chunk-[a-z0-9]+\.js)["']/g)].map(match=>match[1]!);

it('serves each hosted component entry revalidated and its content-addressed chunks immutable',async()=>{
 for(const name of [...hosted.components,...hosted.legacy]){
  const response=await get(name+'.js');
  expect(response.status,name).toBe(200);expect(response.headers.get('content-type')).toMatch(/^text\/javascript/);
  expect(response.headers.get('cache-control'),name).toBe('no-cache');expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(Buffer.from(await response.arrayBuffer()).equals(built(name+'.js')),name).toBe(true);
 }
 const entry=await get('tabs.js'),etag=entry.headers.get('etag')!;
 expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
 const repeat=await get('tabs.js',{'if-none-match':etag});expect(repeat.status).toBe(304);expect(await repeat.text()).toBe('');
 const encoded=await get('tabs.js',{'accept-encoding':'gzip, br'});
 expect(encoded.headers.get('content-encoding')).toBe('br');expect(encoded.headers.get('vary')).toBe('Accept-Encoding');
 expect(brotliDecompressSync(Buffer.from(await encoded.arrayBuffer())).equals(built('tabs.js'))).toBe(true);
 expect((await get('tabs.js',{'if-none-match':encoded.headers.get('etag')!,'accept-encoding':'br'})).status).toBe(304);
 const chunk=chunks(built('select.js').toString())[0]!;expect(chunk).toBeTruthy();
 const shared=await get(chunk);expect(shared.status).toBe(200);expect(shared.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
 for(const refused of ['register-component.js','tabs-model.js','../hosted.json','tabs.ts','chunk-UPPER.js','chunk-missing0.js','deck-gl-engine.js'])expect((await get(refused)).status,refused).toBe(404);
});

it('admits the component directory as a script source of the sandboxed copy',()=>{
 const csp=markupCsp('https://app.example','Page123');
 expect(/script-src [^;]*https:\/\/app\.example\/af\/components\//.test(csp)).toBe(true);
});

it('answers one design system’s platform stylesheet for the local preview',async()=>{
 const one=await styles(new Request('https://app.example/af/styles.css?system=almanac'));
 expect(one.status).toBe(200);const css=await one.text();
 expect(css).toContain(':root[data-af-design-system="almanac"]');expect(css).not.toContain('data-af-design-system="redline"');
 expect((await styles(new Request('https://app.example/af/styles.css?system=nope'))).status).toBe(404);
});

it('embeds a page’s components and the chunks they import in the offline copy',async()=>{
 const html='<!doctype html><html><head></head><body><af-tabs></af-tabs><script type="module">import "@afbin/tabs";import "@afbin/select";</script></body></html>';
 const resources=await referencedLibraryResources(html,[],'https://app.example/a/Page123');
 const urls=resources.map(resource=>resource.url);
 expect(urls).toContain('/af/components/tabs.js');expect(urls).toContain('/af/components/select.js');
 for(const file of [...chunks(built('tabs.js').toString()),...chunks(built('select.js').toString())])expect(urls).toContain('/af/components/'+file);
 expect(urls.some(url=>url.includes('/libraries/'))).toBe(false);
 const packed=await packOfflineDependencies({html,baseUrl:'https://app.example/a/Page123',resources});
 // No import is left to resolve against the platform (esbuild's `// admitted:<url>` provenance comments may remain).
 expect(packed.html).not.toMatch(/(?:from|import)\s*["'](?:@afbin\/(?:tabs|select)|[^"']*\/af\/components\/)/);
 // A page that imports no component carries none.
 expect(await referencedLibraryResources('<script type="module">console.log(1)</script>',[],'https://app.example/a/Page123')).toEqual([]);
});

it('tells a publish naming a missing local component copy to import the hosted module',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');
 const {prepareBundle}=await import('../../../skills/artifactbin/scripts/publication-bundle.mjs');
 const root=mkdtempSync(path.join(tmpdir(),'missing-component-'));
 try{
  writeFileSync(path.join(root,'index.html'),'<script type="module">import {registerTabs} from "./components/tabs.js";registerTabs();</script>');
  await expect(prepareBundle({root,entry:'index.html',server:'https://app.example'})).rejects.toThrow("components are hosted; import '@afbin/tabs' instead of a local copy");
  // Hosted imports upload nothing.
  writeFileSync(path.join(root,'index.html'),'<af-tabs></af-tabs><script type="module">import "@afbin/tabs";</script>');
  expect((await prepareBundle({root,entry:'index.html',server:'https://app.example'})).body.publicationBundle.files).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
