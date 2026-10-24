import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {gzipSync} from 'node:zlib';
import { expect, it } from 'vitest';
import { buildHtmlCore,buildHtmlAssets } from '../build.server';
import { downloadableHtml,assembleHtmlPage } from '../index';
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
 expect(assets.apolloPath).toMatch(/^\/af\/v1\/apollo\/[a-f0-9]{64}$/);
 expect(assets.core).not.toContain(assets.apollo);
 const html=downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,reader:assets.reader,config:{pageId:'p',revision:'1',backends:[]}});
 expect(html).toContain('data-af="apollo"');
 expect(JSON.parse(/data-af="apollo">([\s\S]*?)<\/script>/.exec(html)![1]!)).toBe(assets.apollo);
 expect(html).not.toContain('src="');
});

it('keeps reader code out of the bootstrap and embeds exact portable reader bytes',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.readerPath).toMatch(/^\/af\/v1\/reader\/[a-f0-9]{64}$/);
 expect(assets.core).not.toContain(assets.reader);
 const hosted=assembleHtmlPage({html:'<html><body></body></html>',core:assets.core,config:{pageId:'p',revision:'1',backends:[]}});
 expect(hosted).not.toContain('<script type="application/json" data-af="reader">');
 const portable=downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,reader:assets.reader,config:{pageId:'p',revision:'1',backends:[]}});
 expect(JSON.parse(/data-af="reader">([\s\S]*?)<\/script>/.exec(portable)![1]!)).toBe(assets.reader);
});

import {runInNewContext} from 'node:vm';
it('leaves hosted top-level captures untouched and boots portable and raw local pages',async()=>{
 const assets=await buildHtmlAssets();
 for(const {offline,privatePreview} of [{offline:false,privatePreview:false},{offline:true,privatePreview:false},{offline:undefined,privatePreview:false},{offline:true,privatePreview:true}]) {
  const blobs:string[]=[];let imports:Record<string,string>|undefined;const listeners:string[]=[];
  const blocks:Record<string,string>={...(offline===undefined?{}:{runtime:JSON.stringify({pageId:'p',revision:'1',backends:[],offline})}),...(offline?{reader:JSON.stringify(assets.reader),apollo:JSON.stringify(assets.apollo)}:{})};
  const win={};const location={href:'https://page.example/report',pathname:'/report'};
  const document={readyState:'loading',addEventListener(event:string){listeners.push(event);},documentElement:{hasAttribute(name:string){return privatePreview&&name==='data-af-private-preview';}},querySelector(selector:string){const name=/data-af="([^"]+)"/.exec(selector)?.[1];return name&&blocks[name]?{textContent:blocks[name]}:null;},createElement(){return {type:'',textContent:''};},currentScript:{src:'',after(node:{textContent:string}){imports=JSON.parse(node.textContent).imports;}}};
  const LocalURL=class extends URL {static createObjectURL(blob:Blob){const value=URL.createObjectURL(blob);blobs.push(value);return value;}};
  try {
   runInNewContext(assets.core,{document,location,window:Object.assign(win,{parent:win}),URL:LocalURL,Blob});
   expect(listeners).toEqual(offline!==false?['DOMContentLoaded']:[]);
   expect(imports?.['@afbin/reader']).toMatch(offline?/^blob:/:/^https:\/\/page\.example\/af\/v1\/reader\/[a-f0-9]{64}$/);
   expect(imports?.['@afbin/apollo']).toMatch(offline?/^blob:/:/^https:\/\/page\.example\/af\/v1\/apollo\/[a-f0-9]{64}$/);
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
