import {test} from 'node:test';
import assert from 'node:assert/strict';
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
const source='<Helmet><Query name="people">{`select * from _members`}</Query></Helmet><p id="count">People</p>';
const base={source,coreUrl:'/af/v1/core.js'};
test('members metadata owns one exact local backend link without an Import',()=>{
 const result=admitLocalSource({...base,membersBinding:{backendNamespace:'legacyData',backendHref:'/af/v1/ids/Ab1234'}});
 assert.equal(result.ok,true);
 if(result.ok)assert.deepEqual([...result.plan.backendLinks],[['legacyData','/af/v1/ids/Ab1234']]);
});
test('members metadata cannot introduce remote routing, extra flags or historical current authority',()=>{
 for(const membersBinding of [
 {backendNamespace:'other',backendHref:'/af/v1/ids/Ab1234'},
 {backendNamespace:'legacyData',backendHref:'https://example.invalid/af/v1/ids/Ab1234'},
 {backendNamespace:'legacyData',backendHref:'/af/v1/ids/Ab1234',rows:[]},
 ])assert.equal(admitLocalSource({...base,membersBinding:membersBinding as never}).ok,false);
 assert.equal(admitLocalSource({...base,membersBinding:{backendNamespace:'legacyData',backendHref:'/af/v1/ids/Ab1234'},datasetUnavailable:{reason:'historical-binding-unavailable'}}).ok,false);
});
