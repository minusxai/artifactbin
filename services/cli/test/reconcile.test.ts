import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileDocument} from '../src/reconcile';
import type {LocalDocument} from '../src/document';

const base:LocalDocument={metadata:{id:'abc123',edit_id:'one',title:'Original',visibility:'private'},body:'<div><p id="first">First</p><p id="second">Second</p><p id="third">Third</p></div>'};
test('local reconciliation preserves independent remote nodes and metadata while retaining local edits',()=>{
 const local={metadata:{...base.metadata,title:'Local title'},body:base.body.replace('First','My first').replace('Third','My third')};
 const remote={metadata:{...base.metadata,edit_id:'two',visibility:'unlisted' as const},body:base.body.replace('Second','Their second')};
 const result=reconcileDocument(base,local,remote);assert.ok(result.ok);
 assert.equal(result.document.body,'<div><p id="first">My first</p><p id="second">Their second</p><p id="third">My third</p></div>');
 assert.deepEqual(result.document.metadata,{id:'abc123',edit_id:'two',title:'Local title',visibility:'unlisted'});
});
test('overlapping node edits are refused even when their character ranges do not overlap',()=>{
 const one={...base,body:'<p id="first">Left and right</p>'};
 assert.deepEqual(reconcileDocument(one,{...one,body:one.body.replace('Left','Mine')},{...one,body:one.body.replace('right','theirs')}),{ok:false,fields:['content']});
});
test('identical edits and an unchanged remote head preserve the local proposal',()=>{
 const local={...base,body:base.body.replace('First','Changed')};
 assert.deepEqual(reconcileDocument(base,local,base),{ok:true,document:local});
 assert.deepEqual(reconcileDocument(base,local,local),{ok:true,document:local});
});
test('divergent permission changes require resolution and never choose the broader grant',()=>{
 const result=reconcileDocument(base,{...base,metadata:{...base.metadata,visibility:'public'}},{...base,metadata:{...base.metadata,visibility:'unlisted'}});
 assert.deepEqual(result,{ok:false,fields:['visibility']});
});
