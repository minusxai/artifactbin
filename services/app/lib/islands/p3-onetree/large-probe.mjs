import { transformAsync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import { build, transform } from 'esbuild';
import { JSDOM } from 'jsdom';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { largeFixture } from './large-fixture.mjs';

const fixture=largeFixture();
const rows=fixture.panelRows.map(panel=>panel.replaceAll('<Badge>','<span class="badge">').replaceAll('</Badge>','</span>'));
const names=['zero','one','two'];
const imports=`import { createSignal } from 'solid-js'; import { hydrate, NoHydration, Hydration, renderToString } from 'solid-js/web';`;
const tabs=(server)=>`function Tabs(){const [selected,setSelected]=createSignal(0);const [checked,setChecked]=createSignal(false);return <section id="tabs"><div role="tablist">${names.map((_,i)=>`<button id="tab-${i}" role="tab" aria-selected={selected()===${i}} onClick={() => setSelected(${i})}>Tab ${i}</button>`).join('')}</div>${names.map((_,i)=>`<Hydration><div id="panel-${i}" role="tabpanel" data-state={selected()===${i}?'active':'inactive'} hidden={selected()!==${i}}><NoHydration>${server?rows[i]:''}</NoHydration>${i===1?'<Hydration><button id="switch" type="button" aria-pressed={checked()} onClick={() => setChecked(!checked())}>Switch</button></Hydration>':''}</div></Hydration>`).join('')}</section>}`;
const source=(server)=>`${imports}\n${tabs(server)}\nfunction Doc(){return <main><Hydration><Tabs/></Hydration></main>}\nexport function mount(host){return hydrate(() => <Doc/>,host)}\nexport function render(){return renderToString(() => <Doc/>)};`;
const compile=async(code,generate)=>(await transformAsync(code,{filename:'large-probe.jsx',babelrc:false,configFile:false,presets:[[solidPreset,{generate,hydratable:true}]]})).code;
const sizes=text=>({raw:Buffer.byteLength(text),gzip:gzipSync(text).byteLength,brotli:brotliCompressSync(text).byteLength,createComponent:(text.match(/createComponent/g)||[]).length,template:(text.match(/template\(/g)||[]).length});
const temp=await mkdtemp(path.join(tmpdir(),'p3-large-onetree-'));
const times=[];
let html='';
for(let i=0;i<3;i++){
  const start=performance.now();
  const code=await compile(source(true),'ssr');
  const bundle=await build({stdin:{contents:code,resolveDir:process.cwd(),sourcefile:'large-ssr.js',loader:'js'},bundle:true,write:false,format:'esm',platform:'node'});
  const file=path.join(temp,`server-${i}.mjs`);
  await writeFile(file,bundle.outputFiles[0].text);
  html=(await import(pathToFileURL(file).href)).render();
  times.push(Math.round(performance.now()-start));
}
const startClient=performance.now();
const client=await compile(source(false),'dom');
const min=(await transform(client,{minify:true,loader:'js'})).code;
const clientCompileMs=Math.round(performance.now()-startClient);
if(min.includes('large-last-row')||min.includes('row 0 ')) throw Error('Static row leaked into client module');
const bundle=await build({stdin:{contents:client,resolveDir:process.cwd(),sourcefile:'large-client.js',loader:'js'},bundle:true,write:false,format:'iife',globalName:'P3LargeProbe',platform:'browser',conditions:['development','browser'],minify:false});
const dom=new JSDOM(`<div id="root">${html}</div>`,{url:'http://localhost/'});
for(const key of ['window','document','navigator','Node','Element','HTMLElement','MutationObserver']) Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
const host=dom.window.document.getElementById('root');
const before={lastRow:host.querySelector('#large-last-row'),lastPanel:host.querySelector('#panel-2'),lastTab:host.querySelector('#tab-2')};
const warnings=[];const oldWarn=console.warn,oldError=console.error;
console.warn=(...a)=>warnings.push(['warn',...a].join(' '));console.error=(...a)=>warnings.push(['error',...a].join(' '));
let exception=null;
const keysBefore=(html.match(/data-hk=/g)||[]).length;
try{
  (0,eval)(bundle.outputFiles[0].text);
  globalThis._$HY={done:false,completed:new WeakSet(),events:[],r:{}};
  globalThis.P3LargeProbe.mount(host);
  host.querySelector('#tab-2').click();
  host.querySelector('#switch').click();
}catch(error){exception=String(error.stack??error)}
console.warn=oldWarn;console.error=oldError;
const ordered=[...times].sort((a,b)=>a-b);
const result={sourceBytes:Buffer.byteLength(fixture.source),rowCount:fixture.rowCount,module:sizes(min),html:sizes(html),compileMs:times,medianCompileMs:ordered[1],clientCompileMs,hydration:{identity:Object.fromEntries(Object.entries(before).map(([key,value])=>[key,value===host.querySelector(key==='lastRow'?'#large-last-row':key==='lastPanel'?'#panel-2':'#tab-2')])),selected:host.querySelector('#panel-2')?.getAttribute('data-state'),visible:!host.querySelector('#panel-2')?.hidden,lastRowPreserved:host.querySelector('#large-last-row')?.textContent?.includes('row 1099 '),switchPressed:host.querySelector('#switch')?.getAttribute('aria-pressed'),keysBefore,keysAfter:(host.innerHTML.match(/data-hk=/g)||[]).length,warnings,exception}};
console.log(JSON.stringify(result));
