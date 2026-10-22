import {test} from 'node:test';import assert from 'node:assert/strict';
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
const base={source:'<p id="out">Ready</p>',coreUrl:'/af/v1/core.js'};
const effects={mode:'effects' as const,script:"window.addEventListener('scroll',()=>document.getElementById('out').textContent=String(window.scrollY));",exports:[],mounts:[]};
test('effect mode admits only owned effect plans with no component exports or mounts',()=>{
 assert.equal(admitLocalSource({...base,authorPlan:effects}).ok,true);
 for(const authorPlan of [{...effects,exports:['Widget']},{...effects,mounts:[{identity:'out',component:'Widget'}]},{...effects,script:"window.open('/x')"},{...effects,mode:'other'}])assert.equal(admitLocalSource({...base,authorPlan:authorPlan as never}).ok,false);
 assert.equal(admitLocalSource({...base,authorPlan:{...effects,mode:'components'}}).ok,false);
});
