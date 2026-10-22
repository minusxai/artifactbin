import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
import {createMigrationConverter} from '../src/migration/convert.ts';
import {compileArchivedLocal} from '../src/migration/conversion/compiled/local.ts';
test('offline prototype delegates whole compiled component and expression behavior to archived compiler',async()=>{
 const input={source:'<Helmet><Value name="n" type="number" default={2}/></Helmet><UnknownArchivedWidget id="widget" options={[{a:1}]}>{$n + 5}</UnknownArchivedWidget>',coreUrl:'/af/v1/core.js'};
 assert.equal(admitLocalSource(input).ok,false);
 const admitted=admitLocalSource(input,'offline-prototype');assert.equal(admitted.ok,true);
 let captured:any;
 const result=await compileArchivedLocal(input,{sourceAdmission:'offline-prototype',compiler:{async compile(i){captured=i;return {html:'<div id="widget"><img src="https://example.invalid/image.png">7</div>',css:'',javascript:'const inert="/api/reference </script><!--";globalThis.answer=7;',title:'Proof',build:'frozen',capabilities:[],rootAttributes:{},modules:['known-compiled-widget.js'],declarations:[{name:'n',type:'number',default:2}],queryNames:[],datasetNames:[],mutationNames:[]};}}});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));const payload=JSON.parse(/<script type="application\/json" data-af-compiled-payload>(.*?)<\/script>/.exec(result.html!)![1]!);assert.match(gunzipSync(Buffer.from(payload.base64,'base64')).toString(),/globalThis.answer=7/);assert.match(gunzipSync(Buffer.from(payload.base64,'base64')).toString(),/<\/script><!--/);assert.match(result.html!,/example.invalid\/image.png/);assert.equal(captured.sourceAdmission,'offline-prototype');
});
test('prototype mode preserves binding and state reconciliation and cannot be enabled through input',async()=>{
 const base={source:'<Helmet><Value name="n" type="number" default={2}/></Helmet><div id="proof"/>',coreUrl:'/af/v1/core.js'};
 assert.equal(admitLocalSource({...base,source:'<Helmet><Import name="remote" src="ref:abcdef"/></Helmet><div/>'},'offline-prototype').ok,false);
 assert.equal(admitLocalSource({...base,source:'<Helmet><Mutation name="write">delete from remote</Mutation></Helmet><div/>'},'offline-prototype').ok,false);
 assert.equal(admitLocalSource({...base,source:'<UnknownArchivedWidget/>',sourceAdmission:'offline-prototype'}).ok,false);
 const result=await compileArchivedLocal(base,{sourceAdmission:'offline-prototype',compiler:{async compile(){return {html:'<div id="proof"/>',css:'',javascript:'globalThis.ok=true;',title:'Proof',build:'frozen',capabilities:[],rootAttributes:{},modules:[],declarations:[{name:'n',type:'number',default:999}]};}}});assert.equal(result.classification,'manual-blocked');
});

test('direct converter validates the explicit offline policy before reading source or compiling',()=>{
 for(const strategy of ['strict','archived-static']as const)assert.throws(()=>createMigrationConverter({strategy,sourceAdmission:'offline-prototype'}),/requires archived-functional/);
 assert.throws(()=>createMigrationConverter({strategy:'archived-functional',sourceAdmission:'unknown' as any}),/Unknown migration source admission policy/);
});
