import { transformAsync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import { build, transform } from 'esbuild';
import { JSDOM } from 'jsdom';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const words = 'An authored paragraph whose contents belong to the server document. ';
const prose = Array.from({ length: 3 }, (_, i) => `PANEL_${i}_${words.repeat(300)}`);
const content = (i) => `<p id="static-${i}">${prose[i]}</p><div class="card"><span class="badge">Badge ${i}</span></div>`;
const imports = `import { createSignal } from 'solid-js'; import { hydrate, NoHydration, Hydration, renderToString } from 'solid-js/web';`;
const tabs = (kind, live) => { const sibling=kind.startsWith('sibling'); const control='<Hydration><button id="switch" type="button" aria-pressed={checked()} onClick={() => setChecked(!checked())}>Switch</button></Hydration>'; return `function Tabs(){const [selected,setSelected]=createSignal(0);${live ? 'const [checked,setChecked]=createSignal(false);' : ''} return <section id="tabs"><div role="tablist">${[0,1,2].map(i => `<button id="tab-${i}" role="tab" aria-selected={selected()===${i}} onClick={() => setSelected(${i})}>Tab ${i}</button>`).join('')}</div>${[0,1,2].map(i => `<Hydration><div id="panel-${i}" role="tabpanel" data-state={selected()===${i}?'active':'inactive'} hidden={selected()!==${i}}>${kind === 'full' ? content(i) : `<NoHydration>${kind.includes('placeholder') ? '' : content(i)}${live && !sibling && i === 1 ? control : ''}</NoHydration>${live && sibling && i === 1 ? control : ''}`}</div></Hydration>`).join('')}</section>}`; };
const source = (kind, nested = false) => `${imports}\n${tabs(kind,nested)}\nfunction Doc(){return <main><NoHydration>${kind.includes('placeholder') ? '' : `<h1 id="heading">Static heading</h1><p id="intro">${words.repeat(100)}</p>`}</NoHydration><Hydration><Tabs/></Hydration><NoHydration>${kind.includes('placeholder') ? '' : '<footer id="footer">Static footer</footer>'}</NoHydration></main>}\nexport function mount(host){return hydrate(() => <Doc/>,host)}\nexport function render(){return renderToString(() => <Doc/>)};`;
const compile = async (code, generate) => (await transformAsync(code, { filename:'probe.jsx', babelrc:false, configFile:false, presets:[[solidPreset,{generate,hydratable:true}]] })).code;
const sizes = async code => { const min = (await transform(code,{minify:true,loader:'js'})).code; return {raw:Buffer.byteLength(min),gzip:gzipSync(min).byteLength,brotli:brotliCompressSync(min).byteLength,createComponent:(min.match(/createComponent/g)||[]).length,template:(min.match(/template\(/g)||[]).length,hasStaticText:min.includes('PANEL_0_')}; };
if (process.argv.includes('--large')) {
  await import('./large-probe.mjs');
} else {
const temp = await mkdtemp(path.join(tmpdir(),'p3-onetree-'));
async function renderServer(kind,nested=false){const serverCode=await compile(source(kind,nested),'ssr');const serverPath=path.join(temp,`server-${kind}.mjs`);const serverBundle=await build({stdin:{contents:serverCode,resolveDir:process.cwd(),sourcefile:'probe-ssr.js',loader:'js'},bundle:true,write:false,format:'esm',platform:'node'});await writeFile(serverPath,serverBundle.outputFiles[0].text);return (await import(pathToFileURL(serverPath).href)).render();}
const html = await renderServer('plain');
const dom = new JSDOM(`<div id="root">${html}</div>`, {url:'http://localhost/'});
for (const key of ['window','document','navigator','Node','Element','HTMLElement','MutationObserver']) Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
const warnings=[]; const oldWarn=console.warn, oldError=console.error;
console.warn=(...a)=>warnings.push(['warn',...a].join(' ')); console.error=(...a)=>warnings.push(['error',...a].join(' '));
const results={solidVersion:'1.9.15',htmlBytes:Buffer.byteLength(html),variants:{},warnings};
for (const kind of ['plain','placeholder','full','nested','nested-placeholder','sibling','sibling-placeholder']) {
  const live=kind.startsWith('nested')||kind.startsWith('sibling');
  const served=kind.startsWith('nested') ? await renderServer('nested',true) : kind.startsWith('sibling') ? await renderServer('sibling',true) : html;
  const clientCode=await compile(source(kind,live),'dom');
  const bundle=await build({stdin:{contents:clientCode,resolveDir:process.cwd(),sourcefile:'probe.js',loader:'js'},bundle:true,write:false,format:'iife',globalName:'P3Probe',platform:'browser',conditions:['development','browser'],minify:false});
  const host=dom.window.document.getElementById('root'); host.innerHTML=served;
  const before={heading:host.querySelector('#heading'),static:host.querySelector('#static-0'),tab:host.querySelector('#tab-0'),panel:host.querySelector('#panel-0')};
  globalThis.P3Probe=undefined;
  (0,eval)(bundle.outputFiles[0].text);
  const errorsBefore=warnings.length;
  let exception=null;
  globalThis._$HY={done:false,completed:new WeakSet(),events:[],r:{}};
  try { globalThis.P3Probe.mount(host); host.querySelector('#tab-1').click(); if(live) host.querySelector('#switch').click(); } catch(e) { exception=String(e.stack ?? e); }
  results.variants[kind]={sizes:await sizes(clientCode),ssrHtmlBytes:Buffer.byteLength(served),identity:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v===host.querySelector(k==='heading'?'#heading':k==='static'?'#static-0':k==='tab'?'#tab-0':'#panel-0')])),selected:host.querySelector('#panel-1')?.getAttribute('data-state'),visible:!host.querySelector('#panel-1')?.hidden,staticPreserved:host.querySelector('#static-1')?.textContent===prose[1],switchPressed:host.querySelector('#switch')?.getAttribute('aria-pressed'),warnings:warnings.slice(errorsBefore),exception,keysBefore:(served.match(/data-hk=/g)||[]).length,keysAfter:(host.innerHTML.match(/data-hk=/g)||[]).length};
}
results.split=await sizes(await compile(`${imports}\n${tabs('placeholder',false)}\nexport function mount(host){return hydrate(() => <Tabs/>,host)}`,'dom'));
console.warn=oldWarn;console.error=oldError;
console.log(JSON.stringify(results,null,2));
}
