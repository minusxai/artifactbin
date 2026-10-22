import {test} from 'node:test';import assert from 'node:assert/strict';
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
const flag={reason:'historical-binding-unavailable' as const};const base={coreUrl:'/af/v1/core.js',datasetUnavailable:flag};
test('historical no-Import service revisions admit only explicit unavailable snapshots',()=>{
 const members='<Helmet><Query name="people">{`select * from _members`}</Query></Helmet><p>People</p>';
 const bound='<Helmet><Value name="person" source="ref:Abcd12" column="owner"/></Helmet><User id="person" userId="$person" fallback="Unavailable"/>';
 for(const source of [members,bound]){
  const result=admitLocalSource({...base,source});assert.equal(result.ok,true);
  if(result.ok){assert.equal(result.plan.backendLinks.size,0);assert.equal(result.plan.historical,true);assert.deepEqual(result.plan.input.personBindings,undefined);}
  if(source===bound)assert.equal(admitLocalSource({coreUrl:base.coreUrl,source}).ok,false);
 }
 assert.equal(admitLocalSource({...base,source:'<Helmet><Value name="local" type="number" default={1}/></Helmet><p>Ordinary</p>'}).ok,false);
 assert.equal(admitLocalSource({...base,source:bound,personBindings:[{valueName:'person',backendNamespace:'legacyData'}]}).ok,false);
});
