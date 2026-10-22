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
