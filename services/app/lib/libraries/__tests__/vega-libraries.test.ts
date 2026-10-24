import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {expect,it,vi} from 'vitest';
import {libraryUrls} from '../index';
const directory=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
async function bundled(name:string) {
 const registry=JSON.parse(await readFile(path.join(directory,'registry.json'),'utf8'));
 const entry=registry[name]; expect(entry).toBeDefined();
 const alias=Object.fromEntries(Object.entries(entry.aliases ?? {}).map(([source,target])=>[source,(target as {package:string}).package]));
 const result=await build({entryPoints:[path.join(directory,entry.entry)],alias,bundle:true,minify:true,write:false,metafile:true,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
 for(const output of Object.values(result.metafile!.outputs)) expect(output.imports).toEqual([]);
 expect(Object.keys(result.metafile!.inputs).some(p=>/node_modules\/(?:solid-js|react|react-dom)\//.test(p))).toBe(false);
 const code=result.outputFiles[0]!.text;
 const module=await import(/* @vite-ignore */`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
 return {module,result};
}
it('advertises separate explicitly pinned Vega and Vega-Lite module URLs',()=>{
 expect(libraryUrls('https://example.invalid')).toMatchObject({vega:'https://example.invalid/libraries/vega-6.3.1/index.js','vega-lite':'https://example.invalid/libraries/vega-lite-6.4.3/index.js'});
});
it('keeps the pinned compiler Vega import boundary to four direct utility reexports without a second runtime',async()=>{
 const source=await readFile(require.resolve('vega-lite'),'utf8');
 const imports=[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]vega['"]/g)].flatMap(match=>match[1]!.split(',').map(binding=>binding.trim().split(/\s+as\s+/)[0]));
 expect(imports.sort()).toEqual(['hasOwnProperty','isObject','isString','stringValue']);
 const registry=JSON.parse(await readFile(path.join(directory,'registry.json'),'utf8'));
 const utility=registry['vega-lite'].aliases.vega;
 const utilFile=path.resolve(path.dirname(require.resolve(utility.package)),'../package.json'); expect(JSON.parse(await readFile(utilFile,'utf8')).version).toBe(utility.version);
 const {result}=await bundled('vega-lite'); expect(Object.keys(result.metafile!.inputs).some(p=>/node_modules\/(?:vega|vega-view|vega-scenegraph|vega-dataflow)\//.test(p))).toBe(false);
});
it('renders a native Vega spec from the shipped browser ESM using the CSP-safe interpreter',async()=>{
 const {module:vega}=await bundled('vega'); expect(vega.version).toBe('6.3.1'); expect(typeof vega.changeset).toBe('function');
 const blocked=vi.fn(()=>{throw new Error('Dynamic JavaScript evaluation is forbidden');}); vi.stubGlobal('Function',blocked);
 let view;
 try {
  const spec={width:120,height:80,padding:5,signals:[{name:'barColor',value:'#16a085'}],data:[{name:'rows',values:[{category:'A',value:5},{category:'B',value:8}],transform:[{type:'formula',expr:'datum.value * 2',as:'scaled'}]}],scales:[{name:'x',type:'band',domain:{data:'rows',field:'category'},range:'width'},{name:'y',type:'linear',domain:{data:'rows',field:'scaled'},range:'height'}],marks:[{type:'rect',from:{data:'rows'},encode:{enter:{x:{scale:'x',field:'category'},width:{scale:'x',band:1},y:{scale:'y',field:'scaled'},y2:{scale:'y',value:0},fill:{signal:'barColor'}}}}]};
  view=new vega.View(vega.parse(spec,undefined,{ast:true}),{renderer:'none',expr:vega.expressionInterpreter}); await view.runAsync();
  expect(view.data('rows').map((row:{scaled:number})=>row.scaled)).toEqual([10,16]);
  const svg=await view.toSVG(); expect(svg).toContain('<svg'); expect(svg).toContain('#16a085'); expect(blocked).not.toHaveBeenCalled();
 } finally {view?.finalize(); vi.unstubAllGlobals();}
});
it('compiles Vega-Lite separately and renders its actual output using the same Vega runtime',async()=>{
 const {module:vega}=await bundled('vega'); const {module:lite}=await bundled('vega-lite');
 expect(lite.version).toBe('6.4.3'); expect(Object.keys(lite).sort()).toEqual(['compile','version']);
 const blocked=vi.fn(()=>{throw new Error('Dynamic JavaScript evaluation is forbidden');}); vi.stubGlobal('Function',blocked);
 let view;
 try {
  const {spec}=lite.compile({data:{values:[{category:'A',value:2},{category:'B',value:4}]},mark:'bar',encoding:{x:{field:'category',type:'nominal'},y:{field:'value',type:'quantitative'}},config:{background:'transparent',range:{category:['#16a085','#2980b9']}}});
  view=new vega.View(vega.parse(spec,undefined,{ast:true}),{renderer:'none',expr:vega.expressionInterpreter}); await view.runAsync();
  const svg=await view.toSVG(); expect(svg).toContain('<svg'); expect(svg).toContain('A'); expect(svg).toContain('B'); expect(blocked).not.toHaveBeenCalled();
 } finally {view?.finalize(); vi.unstubAllGlobals();}
});
