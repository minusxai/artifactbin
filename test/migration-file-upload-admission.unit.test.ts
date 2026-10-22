import test from "node:test";
import assert from "node:assert/strict";
import {prepareCompiledFileUploads} from "../src/migration/conversion/compiled/file-upload-admission.ts";
import type {CompiledDatasetBinding} from "../src/migration/conversion/compiled/dataset-contracts.ts";
const source='<Import name="images" ref="fixture"/><Value name="files"/><FileUpload dataset="images" value="$files" accept="image/png"/>';
const dataset:CompiledDatasetBinding={name:"images",legacyRef:"fixture",backendNamespace:"data",backendHref:"/backend",mode:"live",version:1,tables:[]};
test("upload compiler joins source controls only to exact registered namespace/Import metadata",()=>{
 assert.equal(prepareCompiledFileUploads(source,[{backendNamespace:"data",bindingName:"images"}],[dataset])[0]?.valueName,"files");
 for(const bindings of [[],[{backendNamespace:"other",bindingName:"images"}],[{backendNamespace:"data",bindingName:"missing"}],[{backendNamespace:"data",bindingName:"images"},{backendNamespace:"data",bindingName:"images"}]])assert.throws(()=>prepareCompiledFileUploads(source,bindings,[dataset]),/unsupported/i);
 assert.throws(()=>prepareCompiledFileUploads(source,[{backendNamespace:"data",bindingName:"images"}],[{...dataset,mode:"pinned"}]),/unsupported/i);
});

test('full compiled source admission requires trusted attachment registration',async()=>{
 const {admitLocalSource}=await import('../src/migration/conversion/compiled/source-admission.ts');
 const source='<Helmet><Import name="images" src="ref:Abcd12"/><Value name="files" type="string" default=""/><Query name="rows">{`select file from images.rows`}</Query></Helmet><FileUpload id="upload" dataset="images" value="$files" accept="image/png"/>';
 const input={source,coreUrl:'/af/v1/core.js',datasetBindings:[{...dataset,legacyRef:'ref:Abcd12',backendHref:'/af/v1/ids/Bac123',tables:[{schema:'main',table:'rows',columns:[{name:'file',type:'string'}]}]}]};
 assert.equal(admitLocalSource(input).ok,false);
 const admitted=admitLocalSource({...input,datasetAttachments:[{backendNamespace:'data',bindingName:'images'}]});assert.equal(admitted.ok,true,JSON.stringify(admitted));
});

test('lazy upload control retains its source identity on one transparent stable host',async()=>{
 const {preservePresentationHosts}=await import('../src/migration/conversion/compiled/presentation-hosts.ts');
 const node={type:'element' as const,tag:'FileUpload',isComponent:true,attributes:[{name:'id',value:{static:true,json:'upload'},start:0,end:1}],children:[],selfClosing:true,start:0,end:1};
 const [host]=preservePresentationHosts([node],[{tag:'FileUpload',id:'upload'}]);
 assert.equal(host?.tag,'span');assert.equal(host?.attributes?.[0]?.value.json,'upload');assert.equal(host?.children?.[0]?.tag,'FileUpload');assert.equal(host?.children?.[0]?.attributes?.length,0);
});
