import test from 'node:test';import assert from 'node:assert/strict';
import {nativeCommentAnchorHasContinuity,type NativeCommentAnchorContinuityInput} from './comment-anchor-continuity.ts';
const input:NativeCommentAnchorContinuityInput={sourceId:'page',headVersion:8,anchorVersion:3,anchorKey:'paragraph',allocations:[{artifact_id:'page',source_id:'paragraph',first_version:2,retired_version:null}]};
test('an older annotation keeps its continuously live authored identity without importing its old version',()=>{
 const before=structuredClone(input);assert.equal(nativeCommentAnchorHasContinuity(input),true);assert.deepEqual(input,before);
});
test('retired, reused, unproved, duplicate or cross-page identities never attach an older annotation',()=>{
 const row=input.allocations[0]!;
 for(const allocations of [[],[{...row,retired_version:5}],[{...row,retired_version:9}],[{...row,first_version:4}],[{...row,first_version:null}],[{...row,retired_version:undefined}],[{...row,artifact_id:'other'}],[{...row,source_id:'other'}],[row,row]])assert.equal(nativeCommentAnchorHasContinuity({...input,allocations}),false);
 for(const anchorVersion of [null,0,-1,9,'3',NaN,Infinity])assert.equal(nativeCommentAnchorHasContinuity({...input,anchorVersion}),false);
});
test('the current revision still relies on the separately checked exact current DOM identity',()=>{
 assert.equal(nativeCommentAnchorHasContinuity({...input,anchorVersion:8,allocations:[]}),true);
 assert.equal(nativeCommentAnchorHasContinuity({...input,anchorVersion:8,anchorKey:null}),false);
});
