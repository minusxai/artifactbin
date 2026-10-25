import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRetainedFontUrls,prepareNativeRetainedFont} from './resource-fonts.ts';
import {resourceSha256} from './resources.ts';
const bytes=new TextEncoder().encode('retained-font-bytes'),sha=resourceSha256(bytes),url=`/fonts/example.${sha.slice(0,8)}.woff2`;
const manifest={families:{Body:[{url:'/fonts/body.12345678.woff2'}]},app:[{url}],systems:{Display:[{url:'/fonts/display.12345678.woff2'}]}};
test('admits app and system fonts alongside families with exact byte and manifest provenance',()=>{
 assert.equal(nativeRetainedFontUrls(manifest).length,3);
 const raw=JSON.stringify(manifest),asset=prepareNativeRetainedFont(raw,url,bytes);
 assert.deepEqual(asset,{sources:[url],bytes,sha256:sha,extension:'woff2',provenanceSha256:resourceSha256(raw)});
});
test('rejects undeclared paths and changed content without reading arbitrary manifest fields',()=>{
 const raw=JSON.stringify({...manifest,extra:{url:'/fonts/unapproved.12345678.woff2'}});
 assert.equal(prepareNativeRetainedFont(raw,'/fonts/unapproved.12345678.woff2',bytes),undefined);
 assert.equal(prepareNativeRetainedFont(raw,'/fonts/../example.12345678.woff2',bytes),undefined);
 assert.throws(()=>prepareNativeRetainedFont(raw,url,new Uint8Array([1])),/font_digest/);
});
