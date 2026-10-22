import{test}from'node:test';import assert from'node:assert/strict';import{admitLocalSource}from'../src/migration/conversion/compiled/source-admission.ts';
const coreUrl='/af/v1/core.js',viewerBinding={backendNamespace:'legacyData',backendHref:'/af/v1/ids/Bk1234'};
const body='{$_me.id ? <p id="reader">Signed in</p>:<p id="guest">Guest</p>}';
test('only exact registered viewer routing enables original reader conditions',()=>{
 assert.equal(admitLocalSource({source:body,coreUrl}).ok,false);
 const result=admitLocalSource({source:body,coreUrl,viewerBinding});assert.ok(result.ok);assert.equal(result.plan.backendLinks.get('legacyData'),viewerBinding.backendHref);
 for(const binding of [{...viewerBinding,id:'forged'},{...viewerBinding,backendNamespace:'other'},{...viewerBinding,backendHref:'https://example.invalid'}])assert.equal(admitLocalSource({source:body,coreUrl,viewerBinding:binding}).ok,false);
 for(const expression of ['$_me.email','$_me["id"]','$_me','window.user'])assert.equal(admitLocalSource({source:'{'+expression+' ? <p/>:<p/>}',coreUrl,viewerBinding}).ok,false);
 assert.equal(admitLocalSource({source:'<Value name="x"/><p>Ordinary</p>',coreUrl,viewerBinding}).ok,false);
});
test('reader and row conditions preserve durable renderer scope and declared field validation',()=>{
 const prefix='<Value name="rows" type="table" value={[{key:"a",status:"done"}]}/>';
 const scoped=(field:string)=>'<For id="list" each={$rows} keyBy="key">{$_me.id && ($_row.'+field+' !== "done") ? <p id="active">Active</p>:<p id="other">Other</p>}</For>';
 assert.equal(admitLocalSource({source:prefix+scoped('status'),coreUrl,viewerBinding}).ok,true);assert.equal(admitLocalSource({source:prefix+scoped('missing'),coreUrl,viewerBinding}).ok,false);
 assert.equal(admitLocalSource({source:prefix+'{$_me.id && $_row.status ? <p/>:<p/>}',coreUrl,viewerBinding}).ok,false);
});
test('historical reader snapshots are explicitly unavailable and never bind current viewer',()=>{
 const input={source:body,coreUrl,datasetUnavailable:{reason:'historical-binding-unavailable' as const}};const result=admitLocalSource(input);assert.ok(result.ok);assert.equal(result.plan.input.viewerUnavailable,true);assert.equal(result.plan.backendLinks.size,0);assert.equal(admitLocalSource({...input,viewerBinding}).ok,false);
 const current=admitLocalSource({source:body,coreUrl,viewerBinding,viewerUnavailable:true});assert.ok(current.ok);assert.equal(current.plan.input.viewerUnavailable,false);
});
