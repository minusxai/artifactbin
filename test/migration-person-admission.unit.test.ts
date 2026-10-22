import {test} from 'node:test';import assert from 'node:assert/strict';
import {admitLocalSource} from '../src/migration/conversion/compiled/source-admission.ts';
import {validateBoundPersonRouting,admitPersonAttributes} from '../src/migration/conversion/compiled/person-admission.ts';
import type {CompiledMigrationInput} from '../src/migration/conversion/compiled/contracts.ts';
const input:CompiledMigrationInput={coreUrl:'/af/v1/core.js',source:'<Helmet><Import name="items" src="ref:Abcd12"/><Value name="person" source="ref:Abcd12" column="owner"/><Query name="options">{`select owner as value from items.rows`}</Query></Helmet><Select id="select" value="$person" options="$options"/><User id="person" userId="$person" fallback="Choose"/>',datasetBindings:[{name:'items',legacyRef:'ref:Abcd12',backendNamespace:'legacyData',backendHref:'/af/v1/ids/Ab1234',mode:'live',version:1,tables:[{schema:'public',table:'rows',columns:[{name:'owner',type:'user'}]}]}],boundValueColumns:[{valueName:'person',sourceRef:'ref:Abcd12',version:1,bindingName:'items',schema:'public',table:'rows',column:'owner',type:'user'}],personBindings:[{valueName:'person',backendNamespace:'legacyData'}]};
test('selected person source requires exact imported column provenance and routing',()=>{
 assert.equal(validateBoundPersonRouting(input.boundValueColumns!,input.datasetBindings!,input.personBindings!),true);
 assert.equal(admitLocalSource(input).ok,true);
 for(const changed of [{...input,boundValueColumns:[]},{...input,personBindings:[]},{...input,boundValueColumns:input.boundValueColumns!.map(p=>({...p,version:2}))},{...input,source:input.source.replace('userId="$person"','userId="usr_arbitrary"')},{...input,datasetUnavailable:{reason:'historical-binding-unavailable' as const}}])assert.equal(admitLocalSource(changed).ok,false);
});
test('person component props cannot introduce expressions, actions or arbitrary identities',()=>{
 assert.equal(admitPersonAttributes({userId:'$person',avatar:false,link:false},false),'person');
 for(const attrs of [{userId:'usr_arbitrary'},{userId:'$constructor'},{userId:'$person',run:'$save'},{userId:'$person',link:'true'}])assert.throws(()=>admitPersonAttributes(attrs,false));
 assert.throws(()=>admitPersonAttributes({userId:'$person'},true));
});
