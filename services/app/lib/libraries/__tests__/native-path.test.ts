import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {expect,it,vi} from 'vitest';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {registeredLibrarySources,referencedLibraryResources} from '../assets.server';
import {packOfflineDependencies} from '../../offline-dependencies';
import {assembleHtmlPage,downloadableHtml} from '../../html-runtime';
const baseUrl='https://page.example/a/PAGE12/download';
const authored=`<html><head><script src="/af/v1/core.js"></script></head><body><div data-af-id="chart"></div><script type="module" data-af-id="chart-script">
import * as vega from "/libraries/vega-6.3.1/index.js";
import {compile} from "/libraries/vega-lite-6.4.3/index.js";
const native={width:100,height:50,marks:[{type:'rect',encode:{enter:{x:{value:0},y:{value:0},width:{value:40},height:{value:30},fill:{value:'#16a085'}}}}]};
const compiled=compile({data:{values:[{category:'A',value:4}]},mark:'bar',encoding:{x:{field:'category',type:'nominal'},y:{field:'value',type:'quantitative'}}}).spec;
export const output=[];
for(const spec of [native,compiled]) {const view=new vega.View(vega.parse(spec,undefined,{ast:true}),{renderer:'none',expr:vega.expressionInterpreter});try{await view.runAsync();output.push(await view.toSVG());}finally{view.finalize();}}
</script></body></html>`;
function authorModule(html:string):string{
 let result='';const visit=(node:DefaultTreeAdapterMap['node']):void=>{if('tagName'in node&&node.tagName==='script'&&node.attrs.some(a=>a.name==='data-af-id'&&a.value==='chart-script'))result=node.childNodes.map(n=>'value'in n?n.value:'').join('');if('childNodes'in node)node.childNodes.forEach(visit);};visit(parse(html));return result;
}
it('admits only referenced registry URLs, including references in admitted project modules',async()=>{
 const none=await referencedLibraryResources('<p>No chart</p>',[],baseUrl);expect(none).toEqual([]);
 const bytes=new TextEncoder().encode('import * as vega from "/libraries/vega-6.3.1/index.js";');
 const resources=await referencedLibraryResources('<script type="module" src="./chart.js"></script>',[{url:'./chart.js',contentType:'text/javascript',bytes}],baseUrl);expect(resources.map(r=>r.url)).toEqual(['/libraries/vega-6.3.1/index.js']);
 for(const url of ['https://foreign.example/libraries/vega-6.3.1/index.js','/libraries/vega-999.0.0/index.js','/libraries/vega-6.3.1/index.js?token=private'])expect(await referencedLibraryResources(`<script type="module">import "${url}";</script>`,[],baseUrl)).toEqual([]);
 const sources=await registeredLibrarySources();expect(Object.keys(sources)).toContain('/libraries/vega-lite-6.4.3/index.js');
});
it('keeps hosted literal imports and renders native plus compiled specs from the actual packed HTML offline without eval',async()=>{
 const hosted=assembleHtmlPage({html:authored,core:'/* core */',config:{pageId:'PAGE12',revision:'1',backends:[]}});expect(authorModule(hosted)).toContain('from "/libraries/vega-6.3.1/index.js"');
 const resources=await referencedLibraryResources(authored,[],baseUrl);expect(resources).toHaveLength(2);
 const packed=await packOfflineDependencies({html:authored,baseUrl,resources});expect(packed.embeddedUrls).toHaveLength(2);
 const downloaded=downloadableHtml({html:packed.html,core:'/* core */',apollo:'export {};',reader:'export {};',config:{pageId:'PAGE12',revision:'1',backends:[]}});
 const module=authorModule(downloaded);expect(module).not.toContain('from "/libraries/');
 const blocked=vi.fn(()=>{throw Error('eval blocked');});vi.stubGlobal('Function',blocked);
 try{const rendered=await import(/* @vite-ignore */`data:text/javascript;base64,${Buffer.from(module).toString('base64')}`);expect(rendered.output).toHaveLength(2);for(const svg of rendered.output)expect(svg).toContain('<svg');expect(rendered.output[0]).toContain('#16a085');expect(rendered.output[1]).toContain('A');expect(blocked).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
});

it('reads the deployed public directory after bundling relocates import.meta.url',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'library-server-bundle-'));
 try{
  const outfile=path.join(directory,'server.mjs');
  await build({entryPoints:[path.resolve('lib/libraries/assets.server.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node22'});
  const bundled=await import(/* @vite-ignore */pathToFileURL(outfile).href);
  const expected=await registeredLibrarySources();
  expect(await bundled.registeredLibrarySources()).toEqual(expected);
  const resources=await bundled.referencedLibraryResources(authored,[],baseUrl);
  expect(resources.map((resource:{url:string})=>resource.url)).toEqual(['/libraries/vega-6.3.1/index.js','/libraries/vega-lite-6.4.3/index.js']);
  expect(new TextDecoder().decode(resources[0].bytes)).toBe(expected[resources[0].url]);
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('packs direct Mermaid and deck.gl imports from admitted project modules without network dependencies',async()=>{
 const html='<script type="module" data-af-id="chart-script">import mermaid from "/libraries/mermaid-12.0.0/index.js";import {Deck} from "/libraries/deck-gl-9.4.0/index.js";console.log(mermaid,Deck);</script>';
 const resources=await referencedLibraryResources(html,[],baseUrl);expect(resources.map(r=>r.url)).toEqual(['/libraries/deck-gl-9.4.0/index.js','/libraries/mermaid-12.0.0/index.js']);
 const packed=await packOfflineDependencies({html,baseUrl,resources});expect(packed.embeddedUrls).toHaveLength(2);expect(authorModule(packed.html)).not.toMatch(/from ["']\/libraries\//);expect(authorModule(packed.html)).toContain('startOnLoad');
});
