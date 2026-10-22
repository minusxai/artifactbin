import {test} from 'node:test';import assert from 'node:assert/strict';
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
const base={source:'<p id="out">Ready</p>',coreUrl:'/af/v1/core.js'};
const plan={lifecycle:'owned' as const,script:'export function Widget(){return <p>{window.innerWidth}</p>}',exports:['Widget'],mounts:[]};
test('owned component admission reconciles the exact source exports and forbids effect lifetime mixing',()=>{
 assert.equal(admitLocalSource({...base,authorPlan:plan}).ok,true);
 for(const authorPlan of [{...plan,exports:['Other']},{...plan,exports:[]},{...plan,mode:'effects'},{...plan,lifecycle:'unknown'},{...plan,script:'export function Widget(){setTimeout(()=>{},1);return <p/>;}'}])assert.equal(admitLocalSource({...base,authorPlan:authorPlan as never}).ok,false);
});
