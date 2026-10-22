import test from'node:test';import assert from'node:assert/strict';
import{compiledPageMarkup}from'../src/migration/conversion/compiled/page-payload.ts';
import{decodeCompiledPage}from'../src/migration/conversion/compiled/page-payload-decode.ts';
import{decodeCompiledJavascript}from'../src/migration/conversion/compiled/javascript-payload-decode.ts';
import{decodeAscii91}from'../src/migration/conversion/compiled/ascii91.ts';
const extract=(css:string,js:string)=>JSON.parse(/<script type="application\/json" data-af-compiled-payload>(.*?)<\/script>/.exec(compiledPageMarkup(css,js))![1]!);
test('packed page retains exact stylesheet and module bytes; rejects malformed streams before installation',async()=>{
 const css='body::before{content:"☃ </style><script>literal()</script>"}',js='globalThis.answer="☃";';const valid=extract(css,js);let installed='',removed=0;
 const document={querySelector:()=>({remove(){removed++;}}),createElement:()=>({setAttribute(){},set textContent(v:string){installed=v;}}),head:{append(){}},fonts:{ready:Promise.resolve()}} as any;
 assert.equal(await decodeCompiledPage(valid,undefined,decodeCompiledJavascript,decodeAscii91,document),js);assert.equal(installed,css);
 for(const payload of [{...valid,extra:true},{...valid,stylesheet:{...valid.stylesheet,ascii91:''}},{...valid,stylesheet:{...valid.stylesheet,ascii91:valid.stylesheet.ascii91.slice(0,-3)}},{...valid,stylesheet:{...valid.stylesheet,sha256:'0'.repeat(64)}},{...valid,javascript:{...valid.javascript,ascii91:'<'}},{...valid,stylesheet:{...valid.stylesheet,uncompressedBytes:33*1024*1024}}]){installed='';await assert.rejects(decodeCompiledPage(payload,undefined,decodeCompiledJavascript,decodeAscii91,document));assert.equal(installed,'');}
 const controller=new AbortController();controller.abort();await assert.rejects(decodeCompiledPage(valid,controller.signal,decodeCompiledJavascript,decodeAscii91,document));assert.equal(removed,8);
});
test('oversize prototype stylesheet uses the packed fallback within the unchanged page budget',async()=>{
 const {compileArchivedLocal}=await import('../src/migration/conversion/compiled/local.ts');
 const css='/*'+('saved stylesheet ☃ '.repeat(350000))+'*/';
 const result=await compileArchivedLocal({source:'<div id="proof">Saved content</div>',coreUrl:'/af/v1/core.js'},{sourceAdmission:'offline-prototype',compiler:{async compile(){return {html:'<div id="proof">Saved content</div>',css,javascript:'globalThis.ready=true;',title:'Proof',build:'frozen',capabilities:[],rootAttributes:{},modules:[],declarations:[],queryNames:[],datasetNames:[],mutationNames:[]};}}});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));assert.ok(Buffer.byteLength(result.html!)<=6000000);assert.match(result.html!,/data-af-compiled-style-pending/);const payload=JSON.parse(/<script type="application\/json" data-af-compiled-payload>(.*?)<\/script>/.exec(result.html!)![1]!);let installed='';const document={querySelector:()=>({remove(){}}),createElement:()=>({setAttribute(){},set textContent(v:string){installed=v;}}),head:{append(){}},fonts:{ready:Promise.resolve()}}as any;await decodeCompiledPage(payload,undefined,decodeCompiledJavascript,decodeAscii91,document);assert.equal(installed,css);
});
test('an empty stylesheet needs no stream while an empty executable module remains rejected',async()=>{
 const valid=extract('','export {};');let installed='pending';const document={querySelector:()=>null,createElement:()=>({setAttribute(){},set textContent(v:string){installed=v;}}),head:{append(){}},fonts:{ready:Promise.resolve()}}as any;
 assert.equal(await decodeCompiledPage(valid,undefined,decodeCompiledJavascript,decodeAscii91,document),'export {};');assert.equal(installed,'');assert.throws(()=>compiledPageMarkup('body{}',''));
});
test('page navigation cancels a stalled font wait and reveals saved content',{timeout:2000},async()=>{
 const valid=extract('body{color:red}','export {};'),controller=new AbortController();let removed=false;
 const document={querySelector:()=>({remove(){removed=true;}}),createElement:()=>({setAttribute(){},textContent:''}),head:{append(){setTimeout(()=>controller.abort(),5);}},fonts:{ready:new Promise(()=>{})}}as any;
 await assert.rejects(decodeCompiledPage(valid,controller.signal,decodeCompiledJavascript,decodeAscii91,document),/cancel/i);assert.equal(removed,true);
});
