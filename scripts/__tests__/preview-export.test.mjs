import {it,expect} from 'vitest';
import {packPreviewExport} from '../../services/app/skills/artifactbin/scripts/preview-export.mjs';
const resource=(source,type='text/javascript')=>({bytes:Buffer.from(source),contentType:type});
it('packs shared, lazy and cyclic module identities once while retaining authored import maps',async()=>{
 const files=new Map([['/main.js',resource('import {value} from "./shared.js"; export const lazy=()=>import("./lazy.js");')],['/shared.js',resource('export const value=42;')],['/lazy.js',resource('export {value} from "./shared.js"; import "./main.js";')]]),loads=[];
 const html='<script type="importmap">{"imports":{"fixture":"./main.js"}}</script><script type="module">import {lazy} from "fixture"; globalThis.fixture=lazy;</script>';
 const packed=await packPreviewExport({html,pathname:'/index.html',load:async path=>{loads.push(path);if(!files.has(path))throw Error('Missing '+path);return files.get(path);}});
 expect(loads.sort()).toEqual(['/lazy.js','/main.js','/shared.js']);expect(packed).toContain('type="importmap"');expect(packed).toContain('data:text/javascript;base64,');expect(html).toContain('"fixture":"./main.js"');
 const maps=[...packed.matchAll(/<script[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
 expect(Object.keys(maps.find(map=>Object.keys(map.imports).some(key=>key.startsWith('@afbin/local-export/'))).imports)).toHaveLength(3);expect(packed).not.toContain('globalThis.fixture=lazy;</script></script>');
});
it('refuses foreign resources, escapes, computed imports and reserved namespace collisions',async()=>{
 for(const html of ['<script type="module">import "https://foreign.test/a.js";</script>','<script data-af="custom" src="https://foreign.test/a.js"></script>','<script type="module">import "../outside.js";</script>','<script type="module">const x="./a.js";import(x);</script>','<script type="importmap">{"imports":{"@afbin/local-export/0":"./a.js"}}</script>'])await expect(packPreviewExport({html,pathname:'/index.html',load:async()=>{throw Error('must not read');}})).rejects.toThrow(/foreign|escap|Computed|reserved/i);
});
it('embeds CSS and binary resources without changing script-looking payloads into markup',async()=>{
 const html='<link rel="stylesheet" href="./a.css"><script type="module" src="./a.js"></script>';
 const files=new Map([['/a.css',resource('.a{background:url(./a.svg#icon)}','text/css')],['/a.svg',resource('<svg/>','image/svg+xml')],['/a.js',resource('export const value="</script><script>bad()</script>";')]]);
 const packed=await packPreviewExport({html,pathname:'/index.html',load:async path=>{if(!files.has(path))throw Error('Missing '+path);return files.get(path);}});
 expect(packed).toContain('data:text/css;base64,');expect(packed).not.toContain('bad()</script>');expect(packed).toContain('data:text/javascript;base64,');
});
it('honors normalized local import-map addresses and keeps platform imports for the core map',async()=>{
 const html='<script type="importmap">{"imports":{"/original.js":"./mapped.js"}}</script><script type="module">import "@afbin/apollo";import "./original.js";</script>';
 const paths=[];const packed=await packPreviewExport({html,pathname:'/index.html',load:async path=>{paths.push(path);return resource('export const value=1;');}});
 expect(paths).toEqual(['/mapped.js']);expect(packed).toContain('import "@afbin/apollo"');
});

it('preserves distinct original module URLs even when their source bytes match',async()=>{
 const packed=await packPreviewExport({html:'<script type="module">import "./same.js?first";import "./same.js?second";</script>',pathname:'/index.html',load:async()=>resource('export const value=1;')});
 const imports=JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(packed)[1]).imports;
 expect(Object.values(imports)).toHaveLength(2);expect(new Set(Object.values(imports)).size).toBe(2);
});

it('recovers canonical source for repeated exports and refuses corrupt source envelopes',async()=>{
 const {portableScript}=await import('../../services/app/lib/html-runtime/portable.ts');const {portableRenderedDigest,recoverPortableSource}=await import('../../services/app/lib/html-runtime/portable-source.ts');
 const html='<script type="module" src="./main.js"></script>';const load=async()=>resource('export const value=42;');
 const first=await packPreviewExport({html,pathname:'/index.html',load});
 const saved=portableScript({version:1,source:html,renderedDigest:portableRenderedDigest(first),privateState:{draft:'private'}})+first;
 expect(recoverPortableSource(saved)).toBe(html);
 expect(await packPreviewExport({html:saved,pathname:'/index.html',load})).toBe(first);
 await expect(packPreviewExport({html:'<script data-af="portable" type="application/json">{"version":999}</script>',pathname:'/index.html',load})).rejects.toThrow();
});
it('runs the installed graph parser and repeated source recovery with Node alone',async()=>{
 const {readFile,writeFile,mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const {buildPreviewParser}=await import('../../services/app/lib/skills/index.ts');const {portableScript}=await import('../../services/app/lib/html-runtime/portable.ts');const {portableRenderedDigest}=await import('../../services/app/lib/html-runtime/portable-source.ts');
 const html='<script type="module" src="./main.js"></script>',load=async()=>resource('export const value=42;');const rendered=await packPreviewExport({html,pathname:'/index.html',load});const saved=portableScript({version:1,source:html,renderedDigest:portableRenderedDigest(rendered)})+rendered;
 const dir=await mkdtemp(join(tmpdir(),'preview-installed-export-'));try{
  await writeFile(join(dir,'preview-html.mjs'),await buildPreviewParser(await readFile(new URL('../../services/app/skills/artifactbin/scripts/preview-html.mjs',import.meta.url),'utf8')));
  await writeFile(join(dir,'probe.mjs'),'import {packPreviewExport} from "./preview-html.mjs";const packed=await packPreviewExport({html:'+JSON.stringify(saved)+',pathname:"/index.html",load:async()=>({contentType:"text/javascript",bytes:Buffer.from("export const value=42;")})});if(!packed.includes("data:text/javascript;base64,"))throw Error("graph missing");process.stdout.write("packed");');
  expect(execFileSync(process.execPath,[join(dir,'probe.mjs')],{cwd:dir,encoding:'utf8'})).toBe('packed');
 }finally{await rm(dir,{recursive:true,force:true});}
});
