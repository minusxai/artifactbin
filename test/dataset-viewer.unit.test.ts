import{test}from'node:test';import assert from'node:assert/strict';
import{createDatasetViewerService}from'../src/datasets/viewer.ts';
const context={pageId:'Page12',backendId:'Back12',backendVersion:'1',subject:'actor'};
const snapshot={generation:'a'.repeat(64),id:'original-user'};
test('viewer projection returns only fresh owned original identity snapshots',async()=>{
 let calls=0;const service=createDatasetViewerService({snapshot:async()=>{calls++;return snapshot;}});
 const answer=await service.viewer(context);assert.deepEqual(answer,snapshot);assert.notEqual(answer,snapshot);assert.equal(calls,2);
});
test('viewer projection refuses revocation, context changes, malformed identities and cancellation',async()=>{
 for(const replacement of [null,{...snapshot,generation:'b'.repeat(64)},{...snapshot,id:'other'}]){let calls=0;const service=createDatasetViewerService({snapshot:async()=>++calls===1?snapshot:replacement});await assert.rejects(service.viewer(context));}
 for(const initial of [{...snapshot,id:''},{...snapshot,id:'x'.repeat(257)},{...snapshot,generation:'invalid'},{...snapshot,email:'private'}])await assert.rejects(createDatasetViewerService({snapshot:async()=>initial}).viewer(context));
 const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(createDatasetViewerService({snapshot:async()=>{calls++;return snapshot;}}).viewer(context,controller.signal));assert.equal(calls,0);
 let count=0;const mid=new AbortController();await assert.rejects(createDatasetViewerService({snapshot:async()=>{count++;mid.abort();return snapshot;}}).viewer(context,mid.signal));assert.equal(count,1);
});
test('only actual guests may receive a null subject',async()=>{
 const service=createDatasetViewerService({snapshot:async()=>({...snapshot,id:null})});
 await assert.rejects(service.viewer(context));assert.equal((await service.viewer({...context,subject:null})).id,null);
 await assert.rejects(createDatasetViewerService({snapshot:async()=>snapshot}).viewer({...context,subject:null}));
});
