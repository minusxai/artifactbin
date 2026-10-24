import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePersonProjection} from './person-runtime.ts';
test('person lookup never manufactures names or accepts other identities',()=>{
 assert.equal(nativePersonProjection('usr_a',[]),null);
 assert.deepEqual(nativePersonProjection('usr_a',[{id:'usr_a',name:'Actual profile',handle:null,image:null}]),{id:'usr_a',name:'Actual profile',handle:null,image:null});
 assert.throws(()=>nativePersonProjection('usr_a',[{id:'usr_b',name:'Other',handle:null,image:null}]));
 assert.throws(()=>nativePersonProjection('usr_a',[{id:'usr_a',name:null,handle:null,image:null}]));
});
