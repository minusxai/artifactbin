import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {expect,it} from 'vitest';
import {libraryUrls} from '../index';
import registry from '../registry.json';
import {isPublicSkillTopic} from '../../skills';
it('ships both native visualization guides on the public HTTP and archive surface',()=>{expect(isPublicSkillTopic('maps')).toBe(true);expect(isPublicSkillTopic('diagrams')).toBe(true);});
it('provides pinned native Mermaid and framework-free deck.gl APIs as closed browser modules',async()=>{
 expect(libraryUrls()).toMatchObject({pele:'/libraries/pele-1.12.0/index.js','deck-gl':'/libraries/deck-gl-9.4.0/index.js'});
 for(const name of ['pele','deck-gl']){
  const spec=(registry as Record<string,{entry:string}>)[name];expect(spec).toBeDefined();
  const result=await build({entryPoints:[path.resolve('lib/libraries',spec.entry)],bundle:true,minify:true,write:false,metafile:true,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
  for(const output of Object.values(result.metafile!.outputs))expect(output.imports).toEqual([]);
  expect(Object.keys(result.metafile!.inputs).some(p=>/node_modules\/(?:react|react-dom|solid-js)\//.test(p))).toBe(false);
  const module=await import(/* @vite-ignore */`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.contents).toString('base64')}`);
  if(name==='pele'){for(const api of ['mount','render','parse'])expect(typeof module[api]).toBe('function');}
  else{for(const api of ['Deck','MapView','ScatterplotLayer','GeoJsonLayer','HexagonLayer','HeatmapLayer'])expect(typeof module[api]).toBe('function');const layer=new module.ScatterplotLayer({id:'points',data:[{position:[0,0]}],getPosition:(d:{position:number[]})=>d.position});expect(layer.props.data).toHaveLength(1);expect(layer.clone({data:[]}).props.data).toHaveLength(0);}
  expect(result.outputFiles[0]!.contents.byteLength).toBeLessThan(8*1024*1024);
  const source=await readFile(path.resolve('lib/libraries',spec.entry),'utf8');expect(source).not.toContain('html-components');
 }
},30000);
