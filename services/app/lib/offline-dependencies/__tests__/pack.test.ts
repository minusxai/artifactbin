import {describe,it,expect} from 'vitest';
import {packOfflineDependencies,type OfflineDependencyInput,type OfflineDependencyResult} from '..';
const baseUrl='https://example.test/a/page/';
const file=(url:string,contentType:string,text:string)=>({url,contentType,bytes:new TextEncoder().encode(text)});
describe('authorized offline dependency packaging',()=>{
 it('embeds nested CSS and cyclic modules and images without changing surrounding author bytes',async()=>{
  const html='<!doctype html><!-- keep --><html><head><link data-af-id="theme" rel="stylesheet" href="./style.css?rev=1"></head><body><img data-af-id="pic" src="./pic.svg#icon"><script type="module" src="./main.js"></script></body></html>';
  const packed:OfflineDependencyResult=await packOfflineDependencies({html,baseUrl,resources:[file('./style.css?rev=1','text/css','@import "./nested.css"; .a{background:url("./pic.svg#icon")}'),file('./nested.css','text/css','.b{color:red}'),file('./pic.svg','image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg"><path id="icon"/></svg>'),file('./main.js','application/javascript','import {b} from "./b.js";export const a=()=>b;globalThis.answer=b;'),file('./b.js','text/javascript','import {a} from "./main.js";export const b=1;export const run=()=>a;')]});
  expect(packed.html).toContain('<!-- keep -->');expect(packed.html).toContain('data-af-id="pic"');expect(packed.html).toContain('data:image/svg+xml;base64,');expect(packed.html).toContain('#icon');expect(packed.html).toContain('data:text/css;base64,');expect(packed.html).toContain('data:text/javascript;base64,');expect(html).toContain('./main.js');expect(packed.embeddedUrls.length).toBe(5);
 });
 it('fails closed on unreadable, unadmitted or credential-bearing resources',async()=>{
  for(const resources of [[],[file('./secret.png','image/png','x')]])await expect(packOfflineDependencies({html:'<img src="./missing.png">',baseUrl,resources})).rejects.toThrow(/admitted/);
  await expect(packOfflineDependencies({html:'<img src="https://user:secret@example.test/x">',baseUrl,resources:[]})).rejects.toThrow(/credential/);
 });
 it('keeps core and runtime module imports for portable assembly, handles escaping and inline CSS',async()=>{
  const html='<head><script data-af="core" src="/af/v1/core.js"></script></head><body style="background:url(&quot;./p.png?x=1&amp;y=2&quot;)"><script type="module">import {client} from "@afbin/apollo";import "./x.js";</script></body>';
  const packed=await packOfflineDependencies({html,baseUrl,resources:[file('./p.png?x=1&y=2','image/png','png'),file('./x.js','application/javascript','globalThis.ok=true;')]});expect(packed.html).toContain('src="/af/v1/core.js"');expect(packed.html).not.toContain('./x.js');expect(packed.html).toContain('data:image/png;base64,');
 });
 it('refuses MIME confusion and remote unresolved imports',async()=>{
  await expect(packOfflineDependencies({html:'<script type="module" src="./x.js"></script>',baseUrl,resources:[file('./x.js','image/png','alert(1)')]})).rejects.toThrow(/MIME/);
  await expect(packOfflineDependencies({html:'<script type="module" src="./x.js"></script>',baseUrl,resources:[file('./x.js','text/javascript','import "https://elsewhere.test/no.js"')]})).rejects.toThrow(/admitted/);
 });
});

it('rejects computed module loading and embeds literal dynamic imports',async()=>{
 const input:OfflineDependencyInput={html:'<script type="module" src="./main.js"></script>',baseUrl,resources:[file('./main.js','text/javascript','const p="./other.js";import(p)')]};await expect(packOfflineDependencies(input)).rejects.toThrow(/literal/);
 const packed=await packOfflineDependencies({...input,resources:[file('./main.js','text/javascript','import("./other.js").then(x=>globalThis.value=x.value)'),file('./other.js','text/javascript','export const value=42;')]});expect(packed.embeddedUrls.length).toBe(2);
});
it('embeds srcset, icons and JS-imported CSS and binary with their admitted MIME',async()=>{
 const packed=await packOfflineDependencies({html:'<head><link rel="icon" href="./pic.png"></head><img srcset="./pic.png 1x, ./second.png 2x"><script type="module" src="./main.js"></script>',baseUrl,resources:[file('./pic.png','image/png','first'),file('./second.png','image/png','second'),file('./main.js','text/javascript','import "./style.css";'),file('./style.css','text/css','.a{background:url(./pic.png)}')]});expect(packed.html).toContain('data:image/png;base64,');expect(packed.html).toContain('1x, ');expect(packed.html).toContain('data:text/css;base64,');
});

it('removes invalidated subresource integrity only in the rendered copy',async()=>{const html='<script type="module" integrity="sha256-old" src="./x.js"></script>';const packed=await packOfflineDependencies({html,baseUrl,resources:[file('./x.js','text/javascript','globalThis.x=1;')]});expect(packed.html).not.toContain('sha256-old');expect(html).toContain('sha256-old');});
it('preserves exact classic bytes and browser global handoff to the next inline script',async()=>{
 const {JSDOM}=await import('jsdom');const source='var libraryValue=40;function libraryAdd(n){return this.libraryValue+n;}';
 const result=await packOfflineDependencies({html:'<script src="./library.js"></script><script>window.answer=libraryAdd(2);</script>',baseUrl,resources:[file('./library.js','text/javascript',source)]});
 const src=/src="([^"]+)"/.exec(result.html)![1]!;expect(Buffer.from(src.split(',')[1]!,'base64').toString()).toBe(source);
 const dom=new JSDOM(result.html,{runScripts:'dangerously',resources:'usable'});await new Promise<void>((resolve,reject)=>{dom.window.addEventListener('load',()=>resolve());dom.window.addEventListener('error',event=>reject(event.error));});expect(dom.window.answer).toBe(42);dom.window.close();
 await expect(packOfflineDependencies({html:'<script src="./x.js"></script>',baseUrl,resources:[file('./x.js','text/javascript','import("./x.js")')]})).rejects.toThrow(/Classic script dependencies/);
});
it('preserves SVG fragment and custom CSS properties and existing self-contained scripts',async()=>{
 const data='data:text/javascript;base64,'+Buffer.from('var standalone=1;').toString('base64');
 const result=await packOfflineDependencies({html:`<img src="./p.svg#icon"><style>:root{--accent:#aabbcc;--icon:url('./p.svg#icon')}p{color:var(--accent)}</style><script src="${data}"></script>`,baseUrl,resources:[file('./p.svg','image/svg+xml','<svg><path id="icon"/></svg>')]});expect(result.html).toContain('#icon');expect(result.html).toMatch(/--accent:\s*#aabbcc/);expect(result.html).toContain('var(--accent)');expect(result.html).toContain(data);
});
it('bounds HTML size, resource count, per-resource and aggregate bytes before parsing',async()=>{
 const {OFFLINE_DEPENDENCY_LIMITS:l}=await import('..');
 const cases=[{html:'x'.repeat(l.htmlBytes+1),resources:[]},{html:'',resources:Array.from({length:l.resources+1},()=>file('./x','text/plain',''))},{html:'',resources:[{url:'./x',contentType:'image/png',bytes:new Uint8Array(l.resourceBytes+1)}]},{html:'',resources:[{url:'./x',contentType:'image/png',bytes:new Uint8Array(l.totalBytes)},{url:'./y',contentType:'image/png',bytes:new Uint8Array(1)}]}];for(const input of cases)await expect(packOfflineDependencies({...input,baseUrl})).rejects.toThrow(/limit/);
});

it('admits presentation query aliases only for the same immutable page asset',async()=>{
 const admitted='/a/PAGE12/assets?dependency=CHUNK1&revision=2';
 const script=(url:string)=>'<script type="module" src="'+url+'"></script>';
 const resources=[file(admitted,'text/javascript','export const value=42;')];
 const packed=await packOfflineDependencies({html:script(admitted+'&version=8&cache=1#export'),baseUrl,resources});
 expect(packed.embeddedUrls).toHaveLength(1);expect(packed.html).toContain('data:text/javascript;base64,');
 for(const denied of [admitted.replace('revision=2','revision=3'),admitted.replace('PAGE12','OTHER1'),admitted+'&revision=2','https://other.test'+admitted])await expect(packOfflineDependencies({html:script(denied),baseUrl,resources})).rejects.toThrow(/admitted/);
 await expect(packOfflineDependencies({html:script('./plain.js?cache=1'),baseUrl,resources:[file('./plain.js','text/javascript','export const value=42;')]})).rejects.toThrow(/admitted/);
 await expect(packOfflineDependencies({html:script(admitted),baseUrl,resources:[...resources,file(admitted+'&version=3','text/javascript','export const value=99;')]})).rejects.toThrow(/Conflicting/);
});

function inlineModules(html:string):string[]{return [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(match=>match[1]!);}
function embedded(html:string):Record<string,string>{const match=html.match(/<script type="application\/json" data-af="offline-modules">([\s\S]*?)<\/script>/);return match?JSON.parse(match[1]!):{};}
async function executeModule(source:string,html:string){for(const [key,value]of Object.entries(embedded(html)))source=source.replaceAll(JSON.stringify(key),JSON.stringify('data:text/javascript;base64,'+Buffer.from(value).toString('base64')+'#'+key));return import(/* @vite-ignore */`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);}
it('retains shared closed ESM default, named and namespace identity across entries and aliases',async()=>{
 const resource=file('./shared.js','text/javascript','export default {};export let count=0;export function increment(){count++;}');
 const html='<script type="module">import value,{increment} from "./shared.js";import * as same from "https://example.test/a/page/shared.js";export {value,increment,same};export const entry=1;</script><script type="module">import value,* as shared from "./shared.js";export {value,shared};export const entry=2;</script>';
 const packed=await packOfflineDependencies({html,baseUrl,resources:[resource]});const [a,b]=await Promise.all(inlineModules(packed.html).map(source=>executeModule(source,packed.html)));
 expect(a.value).toBe(b.value);expect(a.same).toBe(b.shared);a.increment();expect(b.shared.count).toBe(1);expect(packed.embeddedUrls).toHaveLength(1);
});
it('keeps distinct closed module URLs distinct even when their bytes are identical',async()=>{
 const source='export default {};';const html='<script type="module">import a from "./a.js";import b from "./b.js";export {a,b};</script>';
 const packed=await packOfflineDependencies({html,baseUrl,resources:[file('./a.js','text/javascript',source),file('./b.js','text/javascript',source)]});const result=await executeModule(inlineModules(packed.html)[0]!,packed.html);expect(result.a).not.toBe(result.b);
});
it('retains relative graph resolution while sharing closed leaf modules',async()=>{
 const html='<script type="module">import {value} from "./nested/wrapper.js";import direct from "./nested/leaf.js";export {value,direct};</script>';
 const packed=await packOfflineDependencies({html,baseUrl,resources:[file('./nested/wrapper.js','text/javascript','import value from "./leaf.js";export {value};'),file('./nested/leaf.js','text/javascript','export default {};')]});const result=await executeModule(inlineModules(packed.html)[0]!,packed.html);expect(result.value).toBe(result.direct);
});
it('shares immutable asset aliases and binds separate exports to the exact admitted content',async()=>{
 const asset='/a/PAGE12/assets?dependency=LIB123&revision=3';
 const html=`<script type="module">import first from "${asset}";import second from "${asset}&version=8";export {first,second};</script>`;
 const packed=await packOfflineDependencies({html,baseUrl,resources:[file(asset,'text/javascript','export default {};')]});const result=await executeModule(inlineModules(packed.html)[0]!,packed.html);expect(result.first).toBe(result.second);
 const entry='<script type="module">export {default} from "./content.js";</script>';
 const exports=await Promise.all([1,2].map(async version=>{const value=await packOfflineDependencies({html:entry,baseUrl,resources:[file('./content.js','text/javascript',`export default {version:${version}};`)]});return executeModule(inlineModules(value.html)[0]!,value.html);}));expect(exports[0].default.version).toBe(1);expect(exports[1].default.version).toBe(2);expect(exports[0].default).not.toBe(exports[1].default);
});

it.each(['module.exports={value:7};','exports.value=7;'])("preserves esbuild's CommonJS conversion without require: %s",async source=>{
 const html='<script type="module">import value from "./common.cjs";export default value;</script>';
 const packed=await packOfflineDependencies({html,baseUrl,resources:[file('./common.cjs','text/javascript',source)]});expect((await executeModule(inlineModules(packed.html)[0]!,packed.html)).default.value).toBe(7);
});

it('embeds a shared payload once regardless of inline entry count',async()=>{
 const source='export const value='+JSON.stringify('x'.repeat(20000))+';';const entry='<script type="module">import {value} from "./large.js";console.log(value);</script>';
 const one=await packOfflineDependencies({html:entry,baseUrl,resources:[file('./large.js','text/javascript',source)]});const many=await packOfflineDependencies({html:entry.repeat(10),baseUrl,resources:[file('./large.js','text/javascript',source)]});
 expect(Object.values(embedded(many.html))).toEqual([source]);expect(many.html.length-one.html.length).toBeLessThan(4000);expect(many.html).not.toContain('data:text/javascript;base64,');
});

it('installs one nonce-authorized map and retains blob identities across bfcache',async()=>{
 const packed=await packOfflineDependencies({html:'<script type="module">import value from "./shared.js";</script>',baseUrl,resources:[file('./shared.js','text/javascript','export default {};')]});
 const payload=embedded(packed.html),loader=packed.html.match(/<script data-af="offline-module-loader">([\s\S]*?)<\/script>/)![1]!;const maps:any[]=[],revoked:string[]=[];let hide:(event:{persisted:boolean})=>void=()=>{};
 const document={currentScript:{previousElementSibling:{textContent:JSON.stringify(payload)},after:(map:unknown)=>maps.push(map)},querySelector:()=>({nonce:'trusted-nonce'}),createElement:()=>({})};
 new Function('document','URL','Blob','addEventListener',loader)(document,{createObjectURL:()=> 'blob:shared',revokeObjectURL:(url:string)=>revoked.push(url)},Blob,(_name:string,callback:typeof hide)=>{hide=callback;});
 expect(maps).toHaveLength(1);expect(maps[0].nonce).toBe('trusted-nonce');expect(Object.values(JSON.parse(maps[0].textContent).imports)).toEqual(['blob:shared']);hide({persisted:true});expect(revoked).toEqual([]);hide({persisted:false});expect(revoked).toEqual(['blob:shared']);
});
