import {describe,it,expect} from 'vitest';
import {planPublicationBundle} from '../plan';
const file=(path:string,text:string,contentType='text/plain')=>({path,contentType,base64:Buffer.from(text).toString('base64')});
it('rebases only exact admitted immutable dependencies from reused module and CSS bytes',async()=>{
 const {pinPublicationAssetUrls}=await import('../plan');
 const source='import "/a/OLD123/assets?dependency=CHILD1&revision=2#export";import "/a/OLD123/assets?dependency=CHILD1&revision=3";const literal="/a/OLD123/assets?dependency=CHILD1&revision=2";';
 const result=pinPublicationAssetUrls(source,'NEW123',4,'text/javascript',[{id:'CHILD1',revision:'2'}]);
 expect(result).toContain('import "/a/NEW123/assets?dependency=CHILD1&revision=2&version=4#export"');
 expect(result).toContain('import "/a/OLD123/assets?dependency=CHILD1&revision=3"');
 expect(result).toContain('const literal="/a/OLD123/assets?dependency=CHILD1&revision=2"');
 expect(pinPublicationAssetUrls('a{src:url(/a/OLD123/assets?dependency=CHILD1&revision=2)}','NEW123',4,'text/css',[{id:'CHILD1',revision:'2'}])).toContain('/a/NEW123/assets?dependency=CHILD1&revision=2&version=4');
});
describe('dependency publication plan',()=>{
 it('finds nested CSS assets once and keeps remote datasets',()=>{
 const html='<link rel="stylesheet" href="./css/main.css"><img src="./img/a.svg"><link rel="af-dataset" data-af-name="tasks" href="./data/tasks.csv"><link rel="af-dataset" data-af-name="other" href="ref:ABC123">';
 const plan=planPublicationBundle(html,{entryPath:'index.html',files:[file('css/main.css','body{background:url(../img/a.svg)}','text/css'),file('img/a.svg','<svg/>','image/svg+xml'),file('data/tasks.csv','name\na','text/csv')]});
 expect(plan.dependencies.map(d=>d.path)).toEqual(['img/a.svg','css/main.css','data/tasks.csv']);
 expect(plan.dependencies.at(-1)?.kind).toBe('dataset');
 expect(plan.rewrite(html,'index.html',new Map([['css/main.css','/a/CSS123/raw?v=1'],['img/a.svg','/a/IMG123/raw?v=1'],['data/tasks.csv','ref:DATA12']]))).toContain('href="ref:DATA12"');
 });
 it('lists missing files before an upload can start',()=>expect(()=>planPublicationBundle('<img src="./missing.svg">',{entryPath:'index.html',files:[]})).toThrow('missing.svg'));
 it('rejects traversal, duplicate paths, invalid base64 and CSS cycles',()=>{
 for(const files of [[file('../escape','x')],[file('a','x'),file('./a','y')],[{path:'a',contentType:'text/plain',base64:'???'}]])expect(()=>planPublicationBundle('',{entryPath:'index.html',files})).toThrow();
 expect(()=>planPublicationBundle('<link href="a.css">',{entryPath:'index.html',files:[file('a.css','@import "b.css";','text/css'),file('b.css','@import "a.css";','text/css')]})).toThrow('cycle');
 });
});
it('rewrites literal module imports and inline CSS without changing script strings',()=>{
 const html='<script type="module">import "./main.js"</script><style>body{background:url(./a.svg)}</style><img srcset="./a.svg 1x, ./b.svg 2x">';
 const plan=planPublicationBundle(html,{entryPath:'index.html',files:[file('main.js','import "./nested.js"; const literal="./unchanged.js";','text/javascript'),file('nested.js','export default 1','text/javascript'),file('a.svg','a','image/svg+xml'),file('b.svg','b','image/svg+xml')]});
 expect(plan.dependencies.map(d=>d.path)).toEqual(['nested.js','main.js','a.svg','b.svg']);
 const addresses=new Map(plan.dependencies.map((d,i)=>[d.path,`/a/ASSET${i}/raw?v=1`]));
 expect(plan.rewrite('import "./nested.js"; const literal="./unchanged.js";','main.js',addresses)).toBe('import "/a/ASSET0/raw?v=1"; const literal="./unchanged.js";');
 const rewritten=plan.rewrite(html,'index.html',addresses);expect(rewritten).not.toContain('./a.svg');expect(rewritten).not.toContain('./b.svg');expect(rewritten).not.toContain('./main.js');
});
it('uploads duplicate bytes once while retaining every local path receipt',async()=>{
 const {publishBundleDependencies}=await import('../execute');
 const plan=planPublicationBundle('<img src="a.svg"><img src="b.svg">',{entryPath:'index.html',files:[file('a.svg','<svg/>','image/svg+xml'),file('b.svg','<svg/>','image/svg+xml')]});
 let calls=0;const result=await publishBundleDependencies(plan,'duplicate_bytes_test_01',{reuse:async()=>'',create:async()=>{calls++;return {id:'ASSET1',revision:'1',address:'/a/ASSET1/raw?v=1'};}});
 expect(calls).toBe(1);expect(result.receipts.map(r=>r.id)).toEqual(['ASSET1','ASSET1']);
});
it('pins parent versions once and preserves fragments in HTML, CSS and modules',async()=>{
 const {pinPublicationAssetUrls}=await import('../plan');const url='/a/PAGE12/assets?dependency=ASSET1&revision=1&version=9#icon';
 expect(pinPublicationAssetUrls(`<img src="${url}">`,'PAGE12',2)).toBe('<img src="/a/PAGE12/assets?dependency=ASSET1&amp;revision=1&amp;version=2#icon">');
 expect(pinPublicationAssetUrls(`body{background:url("${url}")}`,'PAGE12',2,'text/css')).toContain('revision=1&version=2#icon');
 expect(pinPublicationAssetUrls(`import "${url}"`,'PAGE12',2,'text/javascript')).toContain('revision=1&version=2#icon');
});
it('keeps core-provided author runtime imports in self-contained native pages',()=>{
 const html='<script type="module">import {client,gql} from "@afbin/apollo"; import "@afbin/reader"; import "@afbin/chrome"; import "@afbin/portable"; console.log(client,gql);</script>';
 expect(planPublicationBundle(html,{entryPath:'index.html',files:[]}).dependencies).toEqual([]);
});
it('keeps the live dataset cell library (@afbin/collab) a core-provided import',()=>{
 const html='<script type="module">import {collab} from "@afbin/collab"; console.log(collab);</script>';
 expect(planPublicationBundle(html,{entryPath:'index.html',files:[]}).dependencies).toEqual([]);
});
it('resolves local backend TypeScript into the native atomic backend source contract',()=>{
 const source='export const typeDefs="type Query { count:Int! }"; export default {count:()=>1};';
 const plan=planPublicationBundle('<link rel="af-resolver" data-af-name="jobs" href="./api.ts">',{entryPath:'index.html',files:[file('api.ts',source,'text/typescript')]});
 expect(plan.resolverSources).toEqual({jobs:source});expect(plan.backends).toEqual([{name:'jobs',path:'api.ts',bytes:Buffer.byteLength(source)}]);expect(plan.dependencies).toEqual([]);expect(plan.html).not.toContain('api.ts');expect(plan.html).toContain('data-af-name="jobs"');
});

it('resolves af-resolver files, refuses one name twice, and treats the removed af-backend rel as no resolver',()=>{
 const source='export const typeDefs="type Query { n:Int }"; export default {n:()=>1};';
 const bundle={entryPath:'index.html',files:[file('budget.ts',source,'text/typescript')]};
 const plan=planPublicationBundle('<link rel="af-resolver" data-af-name="budget" href="./budget.ts">',bundle);
 expect(plan.resolverSources).toEqual({budget:source});expect(plan.backends).toEqual([{name:'budget',path:'budget.ts',bytes:Buffer.byteLength(source)}]);expect(plan.html).not.toContain('budget.ts');
 expect(()=>planPublicationBundle('<link rel="af-resolver" data-af-name="budget" href="./budget.ts"><link rel="af-resolver" data-af-name="budget" href="./budget.ts">',bundle)).toThrow('duplicate');
 // An af-backend link is no resolver: its file is an ordinary uploaded asset.
 const removed=planPublicationBundle('<link rel="af-backend" data-af-name="budget" href="./budget.ts">',bundle);
 expect(removed.resolverSources).toEqual({});expect(removed.backends).toEqual([]);expect(removed.dependencies.map(dep=>dep.path)).toEqual(['budget.ts']);
});

it('accepts atomically supplied backend namespaces but still rejects missing local files',()=>{
 const html='<link rel="af-resolver" data-af-name="db" href="./garden.ts">';
 expect(planPublicationBundle(html,{entryPath:'index.html',files:[]},{resolvedBackendNames:['db']}).dependencies).toEqual([]);
 expect(()=>planPublicationBundle(html,{entryPath:'index.html',files:[]})).toThrow('garden.ts');
 expect(()=>planPublicationBundle(html+'<img src="./missing.svg">',{entryPath:'index.html',files:[]},{resolvedBackendNames:['db']})).toThrow('missing.svg');
});
it('preserves literal native bindings without admitting arbitrary dynamic asset paths',()=>{
 for(const value of ['$pick','{$pick}'])expect(planPublicationBundle(`<DataTable data="$current"/><img src="${value}">`,{entryPath:'index.html',files:[]}).dependencies).toEqual([]);
 for(const html of ['<object data="./missing.pdf">','<img src="$pick/image.svg">','<img src="./missing.svg">'])expect(()=>planPublicationBundle(html,{entryPath:'index.html',files:[]})).toThrow('Unresolved local dependencies');
});
it('accepts a multi-megabyte asset inside the unchanged file limit without recursive base64 validation',()=>{
 const text='x'.repeat(3_900_000),html='<script type="module" src="./engine.js"></script>';
 const plan=planPublicationBundle(html,{entryPath:'index.html',files:[file('engine.js',text,'text/javascript')]});
 expect(plan.dependencies[0]?.bytes.byteLength).toBe(3_900_000);
});
it('keeps rejecting invalid base64 characters, padding and noncanonical encodings',()=>{
 for(const base64 of ['???','A===','AAAA=','AA=A','AA','AA==\n','AB==','AAB='])expect(()=>planPublicationBundle('<a href="asset.bin">a</a>',{entryPath:'index.html',files:[{path:'asset.bin',contentType:'application/octet-stream',base64}]})).toThrow(/base64|byte limit/);
 for(const base64 of ['', 'AA==','AAA=','AAAA'])expect(()=>planPublicationBundle('<a href="asset.bin">a</a>',{entryPath:'index.html',files:[{path:'asset.bin',contentType:'application/octet-stream',base64}]})).not.toThrow();
});
describe('files a page links (<a href>, <area href>)',()=>{
 const pdf=file('docs/rota.pdf','%PDF-1.4','application/pdf');
 it('publishes a linked file with the page and points the link at its address',()=>{
  const html='<a href="./docs/rota.pdf#page=2">Rota</a><map><area href="docs/rota.pdf" alt="Rota"></map>';
  const plan=planPublicationBundle(html,{entryPath:'index.html',files:[pdf]});
  expect(plan.dependencies.map(d=>[d.path,d.kind])).toEqual([['docs/rota.pdf','asset']]);
  const rewritten=plan.rewrite(html,'index.html',new Map([['docs/rota.pdf','/a/PAGE12/assets?dependency=ROTA12&revision=1']]));
  expect(rewritten).toBe('<a href="/a/PAGE12/assets?dependency=ROTA12&amp;revision=1#page=2">Rota</a><map><area href="/a/PAGE12/assets?dependency=ROTA12&amp;revision=1" alt="Rota"></map>');
 });
 it('leaves navigation that names no project file as written',()=>{
  const html='<a href="#top">a</a><a href="?tab=2">b</a><a href="">c</a><a href="mailto:x@example.com">d</a><a href="/a/OTHER1">e</a><a href="https://example.com/x.pdf">f</a><a href="//cdn.example/x.pdf">g</a><a>h</a>';
  const plan=planPublicationBundle(html,{entryPath:'index.html',files:[]});
  expect(plan.dependencies).toEqual([]);expect(plan.rewrite(html,'index.html',new Map())).toBe(html);
 });
 it('refuses a project link to a missing file, and keeps it as written in a save that carries no project',()=>{
  expect(()=>planPublicationBundle('<a href="./missing.pdf">x</a>',{entryPath:'index.html',files:[]})).toThrow('missing.pdf');
  const bare=planPublicationBundle('<a href="./missing.pdf">x</a>',{entryPath:'index.html',files:[]},{linksAsWritten:true});
  expect(bare.dependencies).toEqual([]);expect(bare.rewrite(bare.html,'index.html',new Map())).toBe('<a href="./missing.pdf">x</a>');
  // Element sources stay strict in every save.
  expect(()=>planPublicationBundle('<img src="./missing.svg">',{entryPath:'index.html',files:[]},{linksAsWritten:true})).toThrow('missing.svg');
 });
 it('refuses a file nothing in the page links or fetches, and says what to write',()=>{
  expect(()=>planPublicationBundle('<h1>x</h1>',{entryPath:'index.html',files:[file('data.json','{}','application/json')]})).toThrow(/data\.json[\s\S]*fetch\('\.\/data\.json'\)/);
  const plan=planPublicationBundle('<link rel="preload" as="fetch" href="./data.json" crossorigin>',{entryPath:'index.html',files:[file('data.json','{}','application/json')]});
  expect(plan.dependencies.map(d=>d.path)).toEqual(['data.json']);
 });
 it('publishes a file a script fetches by a literal path, resolved against the page, and leaves the script as written',()=>{
  const html='<script>fetch("./a.json")</script><script type="module">await fetch(`b.json`, {cache:"no-store"});import "./js/app.js";</script><script type="application/json">{"x":"fetch(\'./c.json\')"}</script>';
  const files=[file('a.json','{}','application/json'),file('b.json','{}','application/json'),file('c.json','{}','application/json'),file('js/app.js','export const geo=await fetch(\'./geo/states.geojson\');','text/javascript'),file('geo/states.geojson','{}','application/geo+json')];
  // A JSON block is data, not a script: its text fetches nothing.
  expect(()=>planPublicationBundle(html,{entryPath:'index.html',files})).toThrow(/Not linked from the page: c\.json/);
  const plan=planPublicationBundle(html,{entryPath:'index.html',files:files.filter(f=>f.path!=='c.json')});
  expect(plan.dependencies.map(d=>d.path).sort()).toEqual(['a.json','b.json','geo/states.geojson','js/app.js']);
  // A module's fetch reads against the document, as the browser resolves it: geo/ beside the page, not js/geo/.
  expect(plan.dependencies.find(d=>d.path==='js/app.js')!.dependencies).toEqual([]);
  const addresses=new Map(plan.dependencies.map(d=>[d.path,'/a/P/assets?dependency='+d.path]));
  expect(plan.rewrite(html,'index.html',addresses)).toBe(html.replace('./js/app.js','/a/P/assets?dependency=js/app.js'));
  expect(plan.rewrite('export const geo=await fetch(\'./geo/states.geojson\');','js/app.js',addresses)).toBe('export const geo=await fetch(\'./geo/states.geojson\');');
 });
 it('ignores a literal fetch of a path the project does not hold, or one that is not a file of it',()=>{
  const html='<script type="module">// await fetch("./old.json")\nawait fetch("/api/x");await fetch("https://example.com/y.json");await fetch("../outside.json");await fetch(`./${name}.json`);</script>';
  expect(planPublicationBundle(html,{entryPath:'index.html',files:[]}).dependencies).toEqual([]);
  // A file published before and reused by mapping is reached the same way.
  expect(()=>planPublicationBundle('<script>fetch("./kept.json")</script>',{entryPath:'index.html',files:[],mappings:{'kept.json':{kind:'asset',id:'KEPT12',revision:'1'}}})).not.toThrow();
 });
 it('pins a link to the page version and reads it back as the path the author wrote',async()=>{
  const {pinPublicationAssetUrls,authoringHtml}=await import('../plan');
  const saved='<a href="/a/PAGE12/assets?dependency=ROTA12&amp;revision=1#page=2">Rota</a>';
  expect(pinPublicationAssetUrls(saved,'PAGE12',3)).toBe('<a href="/a/PAGE12/assets?dependency=ROTA12&amp;revision=1&amp;version=3#page=2">Rota</a>');
  expect(authoringHtml(saved,{server:'https://app.example',pageId:'PAGE12',entryPath:'index.html',receipts:[{path:'docs/rota.pdf',kind:'asset',id:'ROTA12',revision:'1'}]})).toBe('<a href="./docs/rota.pdf#page=2">Rota</a>');
 });
});
describe('a root-relative reference',()=>{
 const font=file('assets/fonts/x.woff2','font','font/woff2');
 it('to a file published with the page is carried and rewritten like a relative one, from HTML and CSS',()=>{
  const html='<link rel="stylesheet" href="/css/site.css"><img src="/assets/logo.svg"><a href="/docs/guide.pdf">guide</a>';
  const plan=planPublicationBundle(html,{entryPath:'index.html',files:[file('css/site.css','@font-face{src:url(/assets/fonts/x.woff2)}','text/css'),font,file('assets/logo.svg','<svg/>','image/svg+xml'),file('docs/guide.pdf','%PDF','application/pdf')]});
  expect(plan.dependencies.map(d=>d.path).sort()).toEqual(['assets/fonts/x.woff2','assets/logo.svg','css/site.css','docs/guide.pdf']);
  const addresses=new Map(plan.dependencies.map((d,i)=>[d.path,`/a/ASSET${i}/raw?v=1`]));
  expect(plan.rewrite('@font-face{src:url(/assets/fonts/x.woff2)}','css/site.css',addresses)).not.toContain('/assets/fonts/');
  expect(plan.rewrite(html,'index.html',addresses)).not.toMatch(/"\/(?:css|assets)\//);
 });
 it('to no published file is refused, naming it and what to write instead',()=>{
  expect(()=>planPublicationBundle('<link rel="stylesheet" href="./css/site.css">',{entryPath:'index.html',files:[file('css/site.css','@font-face{src:url(/assets/fonts/x.woff2)}','text/css')]}))
   .toThrow(/\/assets\/fonts\/x\.woff2 \(in css\/site\.css\) names no file published with the page[\s\S]*\.\.\/assets\/fonts\/x\.woff2/);
  expect(()=>planPublicationBundle('<img src="/logo.png">',{entryPath:'index.html',files:[]})).toThrow(/\/logo\.png \(in index\.html\)[\s\S]*\.\/logo\.png/);
 });
 it('to the platform\'s own paths, another host, a link or a bare save stays as written',()=>{
  const html='<link rel="icon" href="/favicon.ico"><style>@font-face{src:url(/af/fonts/inter.woff2)}</style><img src="/a/IMG123/raw?v=1"><script src="//cdn.example.com/x.js"></script><a href="/a/OTHER1">next</a><a href="/@sam/notes">notes</a>';
  const plan=planPublicationBundle(html,{entryPath:'index.html',files:[]});
  expect(plan.dependencies).toEqual([]);
  expect(plan.rewrite(html,'index.html',new Map())).toBe(html);
  expect(planPublicationBundle('<img src="/logo.png">',{entryPath:'index.html',files:[]},{linksAsWritten:true}).dependencies).toEqual([]);
 });
});
