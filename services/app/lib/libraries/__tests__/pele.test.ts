import {build} from 'esbuild';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {libraryUrls} from '../index';
import registry from '../registry.json';

const examples = {
 flowchart: 'flowchart LR\n Draft --> Review\n Review -->|approved| Done\n click Done "https://example.org/guide" "Guide"',
 sequence: 'sequenceDiagram\n participant A as Reader\n participant B as Server\n A->>B: Request\n B-->>A: Response',
 er: 'erDiagram\n READER ||--o{ PAGE : owns\n READER {\n string name\n }\n PAGE {\n string title\n }'
};
it('ships pinned independent Pele APIs and renders readable diagrams with safe links and recoverable errors',async()=>{
 expect(libraryUrls()).toMatchObject({pele:'/libraries/pele-1.12.0/index.js','pele-flowchart':'/libraries/pele-flowchart-1.12.0/index.js'});
 for(const name of ['pele','pele-flowchart','pele-sequence','pele-er']){
  const spec=(registry as Record<string,{entry:string}>)[name];expect(spec).toBeDefined();
  const result=await build({entryPoints:[path.resolve('lib/libraries',spec!.entry)],bundle:true,minify:true,write:false,metafile:true,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
  for(const output of Object.values(result.metafile!.outputs))expect(output.imports).toEqual([]);
  const bytes=result.outputFiles[0]!.contents;
  const api=await import(/* @vite-ignore */`data:text/javascript;base64,${Buffer.from(bytes).toString('base64')}`);
  expect(typeof api.mount).toBe('function');expect(typeof api.PeleError).toBe('function');
  for(const [type,source]of Object.entries(examples)){
   if(name!=='pele'&&name!==`pele-${type}`){expect(api.supports(source)).toBe(false);continue;}
   const rendered=api.render(source,{idPrefix:`test-${type}`,fontFamily:'serif',maxWidth:350});
   expect(rendered.type).toBe(type);expect(rendered.width).toBeGreaterThan(0);expect(rendered.height).toBeGreaterThan(0);
   expect(rendered.svg).toContain('<svg');expect(rendered.svg).toContain('var(--pele-');expect(rendered.svg).not.toContain('<foreignObject');
   for(const label of type==='flowchart'?['Draft','Review','Done']:type==='sequence'?['Reader','Server','Request','Response']:['READER','PAGE','name','title'])expect(rendered.svg).toContain(label);
  }
  expect(()=>api.render('flowchart\n A -->')).toThrow();
  if(name==='pele'||name==='pele-flowchart'){
   const safe=api.render('flowchart LR\n A["<img src=x onerror=alert(1)>"] --> B\n click B "javascript:alert(1)"');
   expect(safe.svg).not.toMatch(/<img|href="javascript:|onerror=/);
   expect(api.render(examples.flowchart).links).toEqual(expect.arrayContaining([expect.objectContaining({href:'https://example.org/guide'})]));
  }
  expect(bytes.byteLength).toBeLessThan(2_000_000);expect(gzipSync(bytes).byteLength).toBeLessThan(400_000);
 }
},30000);
