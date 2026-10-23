// @requires archived-compiler
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeArchivedManagedFrames} from '../src/migration/conversion/compiled/legacy-scripts.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('scalar params normalization needs no mutations and rejects unsupported calls',{skip:!root},async()=>{
 const wrap=(script:string)=>'<Helmet><Value name="count" type="number" default={0}/></Helmet><Iframe><p>Value</p><script>{'+JSON.stringify(script)+'}</script></Iframe>';
 const good=await normalizeArchivedManagedFrames(wrap('mx.params.set("count",mx.params.get("count")+1);mx.params.subscribe(v=>console.log(v.count));'),root!);
 assert.ok(good);assert.equal(good.receipt.paramsBridgeVersion,'scalar-params-v1');assert.doesNotMatch(good.source,/mx\.params/);
 for(const script of ['mx.params.get("missing")','mx.params.get(name)','mx.params.subscribe(["count"])','mx.params.subscribe(names,v=>v)','mx.params.subscribe(["missing"],v=>v)','mx.params.unknown()','const get=mx.params.get','mx.params["get"]("count")'])assert.equal(await normalizeArchivedManagedFrames(wrap(script),root!),null,script);
});
