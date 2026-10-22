// @requires archived-compiler
import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';
import {build} from 'esbuild';import {chromium,firefox,webkit} from 'playwright';
import {prepareArchivedMermaid} from '../src/migration/conversion/compiled/mermaid-prepare.ts';
import {mermaidRuntimeSource} from '../src/migration/conversion/compiled/mermaid-runtime.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('offline Mermaid preserves frozen layout, page fonts and theme without an engine/network/eval in final HTML',{skip:!root},async()=>{
 const files=path.join(root!,'services/app/public/fonts');
 const font=await readFile(path.join(files,'inter-latin-standard-normal.2c295d99.woff2'));
 const css=`@font-face{font-family:DiagramFont;src:url(data:font/woff2;base64,${font.toString('base64')});font-weight:100 900}body{font-family:DiagramFont;font-size:14px;--font-mono:DiagramFont}.light{--background:white;--foreground:#111111;--primary:#2255aa;--card:white;--muted:#dddddd;--accent:#eeeeee;--border:#777777;--muted-foreground:#555555}.dark{--background:#111111;--foreground:white;--primary:#99aaff;--card:#222222;--muted:#333333;--accent:#444444;--border:#aaaaaa;--muted-foreground:#bbbbbb}`;
 const plan={id:'diagram',title:'Typed workflow',code:'flowchart LR\n A[Review actual font width] --> B[Saved output]'};
 const prepared=await prepareArchivedMermaid(root!,{html:'<div data-mx-inline-story class="light"><figure id="diagram" class="my-4"></figure></div>',css,plans:[plan]});
 assert.ok(prepared[0]!.variants.light.svg.length<30000);
 const require=createRequire(path.join(root!,'package.json'));const babel=require('@babel/core');const preset=require('babel-preset-solid');
 const runtime=babel.transformSync(mermaidRuntimeSource(prepared),{filename:'mermaid.jsx',babelrc:false,configFile:false,presets:[[preset,{generate:'dom',hydratable:true}]]}).code;
 const bundled=await build({stdin:{contents:`import {render} from 'solid-js/web';import {Mermaid} from 'prepared-mermaid';render(()=>Mermaid(${JSON.stringify(plan)}),document.getElementById('mount'));`,resolveDir:root!},bundle:true,write:false,format:'iife',platform:'browser',minify:true,plugins:[{name:'prepared',setup(b){b.onResolve({filter:/^prepared-mermaid$/},()=>({path:'prepared',namespace:'prepared'}));b.onLoad({filter:/.*/,namespace:'prepared'},()=>({contents:runtime,loader:'js',resolveDir:root!}));b.onResolve({filter:/^migration-mermaid-theme$/},()=>({path:path.join(root!,'services/app/lib/islands/kit/theme-watch.ts')}));}}]});
 const javascript=bundled.outputFiles[0]!.text;
 assert.doesNotMatch(javascript,/new Function|\beval\s*\(|\bfetch\s*\(|\bimport\s*\(/);
 assert.ok(Buffer.byteLength(css+javascript)<4000000);
 for(const engine of [chromium,firefox,webkit]){
  const browser=await engine.launch();try{
   const page=await browser.newPage();const errors:string[]=[];const network:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
   await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';font-src data:;img-src data:;connect-src 'none';worker-src 'none'"><style>${css}</style><div data-mx-inline-story class="light"><div id="mount"></div></div>`);
   await page.evaluate(()=>document.fonts.load('14px DiagramFont','Review actual font width Saved output'));
   await page.addScriptTag({content:javascript});
   await page.locator('figure[data-mx-mermaid-state="ready"] svg').waitFor();
   const measured=await page.locator('figure svg').evaluate(el=>({box:el.getAttribute('viewBox'),font:getComputedStyle(el.querySelector('text')!).fontFamily,text:el.textContent,width:el.getBoundingClientRect().width,textWidths:[...el.querySelectorAll('text')].map(t=>(t as SVGTextElement).getBBox().width)}));
   assert.ok(measured.font.includes('DiagramFont'));assert.match(measured.text!,/Review actual font width/);assert.ok(measured.width>0);
   assert.equal(measured.textWidths.length,prepared[0]!.variants.light.textWidths.length);
   const originalWidths=await page.evaluate(svg=>{const probe=document.createElement('div');probe.innerHTML=svg;(probe.firstElementChild as SVGElement).style.textRendering='geometricPrecision';document.querySelector('[data-mx-inline-story]')!.append(probe);const widths=[...probe.querySelectorAll('text')].map(el=>(el as SVGTextElement).getBBox().width);probe.remove();return widths;},prepared[0]!.variants.light.svg);
   measured.textWidths.forEach((width,index)=>assert.ok(Math.abs(width-originalWidths[index]!)<1,`same loaded-font label width in ${engine.name()}`)); 
   assert.equal(measured.box,(/viewBox="([^"]+)"/.exec(prepared[0]!.variants.light.svg)![1]!));
   await page.locator('[data-mx-inline-story]').evaluate(el=>el.setAttribute('class','dark'));
   await page.waitForFunction(()=>document.querySelector('figure svg')?.id==='mx-mermaid-2');
   await page.locator('[data-mx-inline-story]').evaluate(el=>(el as HTMLElement).style.fontSize='30px');
   await page.waitForFunction(()=>document.querySelector('figure')?.getAttribute('data-mx-mermaid-state')==='error');
   assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  }finally{await browser.close();}
 }
});