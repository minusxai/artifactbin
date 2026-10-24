import {describe,it,expect} from 'vitest';
import {planPublicationBundle} from '../plan';
const file=(path:string,text:string,contentType='text/plain')=>({path,contentType,base64:Buffer.from(text).toString('base64')});
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
