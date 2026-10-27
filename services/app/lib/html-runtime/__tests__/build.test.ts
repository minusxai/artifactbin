import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {gzipSync} from 'node:zlib';
import { expect, it } from 'vitest';
import { buildHtmlCore,buildHtmlAssets } from '../build.server';
import { downloadableHtml,assembleHtmlPage } from '../index';
import { PLATFORM_STYLES_PATH } from '../../html-systems';
it('builds a classic bootstrap and a self-contained downloadable page', async () => {
  const {core,apollo,reader} = await buildHtmlAssets();
  expect(() => new Function(core)).not.toThrow();
  const html = downloadableHtml({ html: '<html><body><h1 data-af-id="n1">Hello</h1></body></html>', core, apollo, reader, config: { pageId: 'p1', revision: '1', backends: [] } });
  expect(html).toContain('@afbin/apollo');
  expect(html).toContain('"offline":true');
  expect(html).not.toContain('src="');
});

it('keeps executable inline JavaScript in assembled static HTML under the 10 KiB budget',async()=>{
 const html=assembleHtmlPage({html:'<html><body><h1>Static report</h1></body></html>',core:await buildHtmlCore(),config:{pageId:'p',revision:'1',backends:[]}});
 const scripts:string[]=[];
 const visit=(node:DefaultTreeAdapterMap['node'])=>{
  if('attrs' in node&&node.nodeName==='script'&&!node.attrs.some(attr=>attr.name==='type'&&['application/json','importmap'].includes(attr.value)))scripts.push(node.childNodes.map(child=>'value' in child?child.value:'').join(''));
  if('childNodes' in node)for(const child of node.childNodes)visit(child);
 };
 for(const node of parse(html).childNodes)visit(node);
 expect(gzipSync(scripts.join('\n')).byteLength).toBeLessThan(10*1024);
});

it('hosted readers omit the author engine, while downloads carry the same module without network dependencies',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.apolloPath).toBe("/af/apollo.js");
 expect(assets.core).not.toContain(assets.apollo);
 const html=downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,reader:assets.reader,config:{pageId:'p',revision:'1',backends:[]}});
 expect(html).toContain('data-af="apollo"');
 expect(JSON.parse(/data-af="apollo">([\s\S]*?)<\/script>/.exec(html)![1]!)).toBe(assets.apollo);
 expect(html).not.toContain('src="');
});

it('keeps reader code out of the bootstrap and embeds exact portable reader bytes',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.readerPath).toBe("/af/reader.js");
 expect(assets.core).not.toContain(assets.reader);
 const hosted=assembleHtmlPage({html:'<html><body></body></html>',core:assets.core,config:{pageId:'p',revision:'1',backends:[]}});
 expect(hosted).not.toContain('<script type="application/json" data-af="reader">');
 const portable=downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,reader:assets.reader,config:{pageId:'p',revision:'1',backends:[]}});
 expect(JSON.parse(/data-af="reader">([\s\S]*?)<\/script>/.exec(portable)![1]!)).toBe(assets.reader);
});

import {runInNewContext} from 'node:vm';
it('marks overflowing tables in the native HTML core and updates the fade at the scroll end',async()=>{
 const core=await buildHtmlCore();
 const makeTable=(scrollWidth:number,clientWidth:number)=>{
  const attributes=new Map<string,string>(),listeners=new Map<string,(event:Event)=>void>();
  const table={scrollWidth,clientWidth,scrollLeft:0,attributes,listeners,
   hasAttribute(name:string){return attributes.has(name);},
   setAttribute(name:string,value:string){attributes.set(name,value);},
   removeAttribute(name:string){attributes.delete(name);},
   addEventListener(name:string,listener:(event:Event)=>void){listeners.set(name,listener);},
   removeEventListener(name:string){listeners.delete(name);},
  };
  return table;
 };
 const wide=makeTable(900,340),fits=makeTable(300,340),late=makeTable(900,340),tables:Array<ReturnType<typeof makeTable>>=[];
 const resizeListeners=new Map<string,(event:Event)=>void>();let resizeAdds=0,resizeRemoves=0;
 let mutationCallback:MutationCallback|undefined,disconnectedObservers=0;
 const timers=new Map<number,()=>void>();let nextTimer=1;
 class Observer{constructor(readonly callback:MutationCallback){mutationCallback=callback;}observe(){}disconnect(){disconnectedObservers++;}}
 const win={setTimeout:(callback:()=>void)=>{const id=nextTimer++;timers.set(id,callback);return id;},clearTimeout(id:number){timers.delete(id);},addEventListener(name:string,listener:(event:Event)=>void){if(name==='resize')resizeAdds++;resizeListeners.set(name,listener);},removeEventListener(name:string){if(name==='resize')resizeRemoves++;resizeListeners.delete(name);},MutationObserver:Observer};
 (win as {parent?:unknown}).parent=win;
 let ready:((event:Event)=>void)|undefined;
 const doc={defaultView:win,readyState:'loading',body:{},addEventListener(name:string,listener:(event:Event)=>void){if(name==='DOMContentLoaded')ready=listener;},removeEventListener(name:string){if(name==='DOMContentLoaded')ready=undefined;},documentElement:{hasAttribute:()=>false},
  querySelector(selector:string){if(selector==='table')return wide;return selector==='[data-af="runtime"]'?{textContent:JSON.stringify({pageId:'p',revision:'1',backends:[],offline:false})}:null;},
  querySelectorAll(selector:string){return selector.startsWith('table')?tables:[];},
  createElement(){return {type:'',textContent:''};},currentScript:{src:'',after(){}},
 };
 runInNewContext(core,{document:doc,window:win,location:{href:'https://page.example/report'},URL,Blob});
 expect(wide.attributes.has('data-mx-scrollable')).toBe(false);
 // The core is in <head>; it waits for parsing, then observes an empty body
 // so the first table inserted after startup receives the affordance.
 ready?.(new Event('DOMContentLoaded'));
 tables.push(wide,fits);
 mutationCallback?.([] as unknown as MutationRecord[],{} as MutationObserver);
 const initialInsert=[...timers.entries()].find(([id])=>id!==1);
 if(initialInsert){timers.delete(initialInsert[0]);initialInsert[1]();}
 expect(wide.attributes.get('data-mx-scrollable')).toBe('');
 expect(fits.attributes.has('data-mx-scrollable')).toBe(false);
 wide.scrollLeft=560;wide.listeners.get('scroll')?.({currentTarget:wide} as unknown as Event);
 expect(wide.attributes.get('data-mx-scrollable')).toBe('end');
 wide.scrollLeft=0;wide.listeners.get('scroll')?.({currentTarget:wide} as unknown as Event);
 expect(wide.attributes.get('data-mx-scrollable')).toBe('');
 wide.clientWidth=1000;resizeListeners.get('resize')?.(new Event('resize'));
 expect(wide.attributes.has('data-mx-scrollable')).toBe(false);
 tables.push(late);
 mutationCallback?.([] as unknown as MutationRecord[],{} as MutationObserver);
 const queued=[...timers.entries()].find(([id])=>id!==1);
 if(queued){timers.delete(queued[0]);queued[1]();}
 expect(late.attributes.get('data-mx-scrollable')).toBe('');
 // Re-running the core replaces its document owner and tears down the prior
 // observer/listeners before the replacement starts.
 runInNewContext(core,{document:doc,window:win,location:{href:'https://page.example/report'},URL,Blob});
 expect(disconnectedObservers).toBe(1);
 ready?.(new Event('DOMContentLoaded'));
 expect(resizeAdds-resizeRemoves).toBe(1);
 resizeListeners.get('pagehide')?.(new Event('pagehide'));
 expect(disconnectedObservers).toBe(2);
 resizeListeners.get('pageshow')?.(new Event('pageshow'));
 expect(resizeAdds-resizeRemoves).toBe(1);
});
it('leaves hosted top-level captures untouched and boots portable and raw local pages',async()=>{
 const assets=await buildHtmlAssets();
 for(const {offline,privatePreview} of [{offline:false,privatePreview:false},{offline:true,privatePreview:false},{offline:undefined,privatePreview:false},{offline:true,privatePreview:true}]) {
  const blobs:string[]=[];let imports:Record<string,string>|undefined,mapNonce:string|undefined;const listeners:string[]=[];
  const blocks:Record<string,string>={...(offline===undefined?{}:{runtime:JSON.stringify({pageId:'p',revision:'1',backends:[],offline})}),...(offline?{reader:JSON.stringify(assets.reader),apollo:JSON.stringify(assets.apollo)}:{})};
  const win={};const location={href:'https://page.example/report',pathname:'/report'};
  const document={readyState:'loading',addEventListener(event:string){listeners.push(event);},documentElement:{setAttribute(){},hasAttribute(name:string){return privatePreview&&name==='data-af-private-preview';}},querySelector(selector:string){const name=/data-af="([^"]+)"/.exec(selector)?.[1];return name&&blocks[name]?{textContent:blocks[name]}:null;},createElement(){return {type:'',textContent:''};},currentScript:{src:'',nonce:'platform-render-nonce',after(node:{textContent:string;nonce?:string}){imports=JSON.parse(node.textContent).imports;mapNonce=node.nonce;}}};
  const LocalURL=class extends URL {static createObjectURL(blob:Blob){const value=URL.createObjectURL(blob);blobs.push(value);return value;}};
  try {
   runInNewContext(assets.core,{document,location,window:Object.assign(win,{parent:win}),URL:LocalURL,Blob});
   expect(listeners).toEqual(['DOMContentLoaded']);expect(mapNonce).toBe('platform-render-nonce');
   expect(imports?.['@afbin/reader']).toMatch(offline?/^blob:/:/^https:\/\/page\.example\/af\/reader\.js$/);
   expect(imports?.['@afbin/apollo']).toMatch(offline?/^blob:/:/^https:\/\/page\.example\/af\/apollo\.js$/);
   if(offline){expect(await (await fetch(imports!['@afbin/reader']!)).text()).toBe(assets.reader);expect(await (await fetch(imports!['@afbin/apollo']!)).text()).toBe(assets.apollo);}
  }finally{for(const url of blobs)URL.revokeObjectURL(url);}
 }
});
it('ships shared offline chrome within explicit code and style byte budgets',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.chrome).toContain('data-af-local-chrome');
 expect(gzipSync(assets.core).byteLength).toBeLessThan(10*1024);
 expect(gzipSync(assets.reader).byteLength).toBeLessThan(20*1024);
 expect(gzipSync(assets.chrome!).byteLength).toBeLessThan(180*1024);
 const html=downloadableHtml({html:'<html><body>Offline</body></html>',...assets,config:{pageId:'local',revision:'local',backends:[]}});
 expect(JSON.parse(/data-af="chrome">([^<]*)<\/script>/.exec(html)![1]!)).toBe(assets.chrome);
 expect(JSON.parse(/data-af="portable-engine">([^<]*)<\/script>/.exec(html)![1]!)).toBe(assets.portableEngine);
 expect(assets.core).toContain('@afbin/portable');
});

it('installs shared offline modules in the core single import map and preserves portable source',async()=>{
 const {JSDOM}=await import('jsdom');const {packOfflineDependencies}=await import('../../offline-dependencies');const {recoverPortableSource}=await import('../portable-source');
 const source='<script type="module">import value from "./shared.js";console.log(value);</script>',library='export default {};';
 const packed=await packOfflineDependencies({html:source,baseUrl:'https://example.test/',resources:[{url:'./shared.js',contentType:'text/javascript',bytes:new TextEncoder().encode(library)}]});
 const core=await buildHtmlCore(),html=downloadableHtml({html:packed.html,core,apollo:'export {};',reader:'export {};',platformScriptNonce:'test-nonce-1234567890',portable:{version:1,source},config:{pageId:'p',revision:'1',backends:[]}});
 expect(recoverPortableSource(html)).toBe(source);const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.test/'}),win=dom.window,blobs:string[]=[],revoked:string[]=[];
 win.URL.createObjectURL=()=>{const url='blob:module-'+blobs.length;blobs.push(url);return url;};win.URL.revokeObjectURL=url=>revoked.push(url);
 Object.defineProperty(win,'parent',{value:{}});const coreElement=win.document.querySelector('script[data-af="core"]')!;Object.defineProperty(win.document,'currentScript',{value:coreElement});win.eval(core);
 const maps=win.document.querySelectorAll('script[type="importmap"]');expect(maps).toHaveLength(1);expect(maps[0]!.getAttribute('nonce')).toBe('test-nonce-1234567890');const imports=JSON.parse(maps[0]!.textContent!).imports;
 expect(imports['@afbin/apollo']).toMatch(/^blob:/);expect(imports['@afbin/reader']).toMatch(/^blob:/);const shared=Object.entries(imports).filter(([key])=>key.startsWith('@afbin/offline/'));expect(shared).toHaveLength(1);
 win.dispatchEvent(new win.PageTransitionEvent('pagehide',{persisted:true}));expect(revoked).toEqual([]);win.dispatchEvent(new win.PageTransitionEvent('pagehide',{persisted:false}));expect(revoked).toEqual([shared[0]![1]]);dom.window.close();
});

it('links the platform stylesheet after the core and before authored styles, and tells the core the appearance (D3/D4)',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.systems).toContain(':root[data-af-design-system="redline"]');
 const hosted=assembleHtmlPage({html:'<html data-af-dark="false"><head><meta name="artifactbin:design-system" content="nocturne"><style>h1{color:red}</style></head><body></body></html>',core:assets.core,systemsHref:PLATFORM_STYLES_PATH,config:{pageId:'p',revision:'1',backends:[]}});
 const head=/<head>([\s\S]*)<\/head>/.exec(hosted)![1]!;
 expect(head.indexOf('data-af="core"')).toBeLessThan(head.indexOf('data-af="platform-styles"'));
 expect(head.indexOf(`href="${PLATFORM_STYLES_PATH}"`)).toBeLessThan(head.indexOf('<style>'));
 expect(JSON.parse(/data-af="runtime">([\s\S]*?)<\/script>/.exec(hosted)![1]!).appearance).toEqual({designSystem:'nocturne',mode:'light'});
 const owner=assembleHtmlPage({html:'<html><head><meta name="artifactbin:design-system" content="redline"></head><body></body></html>',core:assets.core,systemsHref:PLATFORM_STYLES_PATH,designSystem:'phosphor',config:{pageId:'p',revision:'1',backends:[]}});
 expect(JSON.parse(/data-af="runtime">([\s\S]*?)<\/script>/.exec(owner)![1]!).appearance).toEqual({designSystem:'phosphor',mode:'dark'});
 expect(assembleHtmlPage({html:'<html><head></head><body></body></html>',core:assets.core,systemsHref:PLATFORM_STYLES_PATH,config:{pageId:'p',revision:'1',backends:[]}})).not.toContain('platform-styles');
 expect(downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,reader:assets.reader,systemsHref:PLATFORM_STYLES_PATH,config:{pageId:'p',revision:'1',backends:[]}})).not.toContain('platform-styles');
});

it('the core sets the platform attributes before authored code, with the viewer mode from ?mx-mode= winning',async()=>{
 const {core}=await buildHtmlAssets();
 const {JSDOM}=await import('jsdom');
 const run=(url:string,appearance:unknown)=>{
  const dom=new JSDOM(`<html data-af-design-system="old"><head><script type="application/json" data-af="runtime">${JSON.stringify({pageId:'p',revision:'1',backends:[],offline:true,appearance})}</script></head><body></body></html>`,{url,runScripts:'outside-only'});
  try{dom.window.eval(core);}catch{/* later portable checks need a reader block; the attributes are set first */}
  return dom.window.document.documentElement;
 };
 const root=run('https://p.example/',{designSystem:'nocturne',mode:'dark'});
 expect(root.getAttribute('data-af-design-system')).toBe('nocturne');expect(root.getAttribute('data-af-dark')).toBe('true');
 const viewer=run('https://p.example/?mx-mode=light',{designSystem:'nocturne',mode:'dark'});
 expect(viewer.getAttribute('data-af-dark')).toBe('false');expect(viewer.style.colorScheme).toBe('light');
});
