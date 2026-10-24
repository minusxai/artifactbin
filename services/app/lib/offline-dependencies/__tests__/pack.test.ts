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
