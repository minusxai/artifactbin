import test from 'node:test';
import assert from 'node:assert/strict';
import { admitsMutationOnlyImports } from '../src/migration/conversion/compiled/mutation-only.ts';
test('registered mutation-only imports retain the named operation without inventing reads',()=>{
 const input={queryNames:[],localMutationNames:[],declaredMutationNames:['restore'],registeredMutationNames:['restore']};
 assert.equal(admitsMutationOnlyImports(input),true);
 for(const change of [{registeredMutationNames:[]},{registeredMutationNames:['other']},{declaredMutationNames:[]},{queryNames:['rows']},{localMutationNames:['local']},{declaredMutationNames:['restore','restore']}])assert.equal(admitsMutationOnlyImports({...input,...change}),false);
});
test('mutation-only generated runtime invokes the registered operation and refreshes without a read engine',async()=>{
 const {datasetMutationBoot}=await import('../src/migration/conversion/compiled/dataset-mutation-boot.ts');
 const {createCompiledDatasetMutations,compiledMutationIntentStore}=await import('../src/migration/conversion/compiled/dataset-mutations.ts');
 const {createCompiledMutationAvailability}=await import('../src/migration/conversion/compiled/mutation-availability.ts');
 const {createClient,gql}=await import('../src/apollo/client.ts');
 const {persistentStore}=await import('../src/browser/core/standalone.ts');
 const disk=new Map<string,string>();const local=createClient({backends:[],state:persistentStore({},'helper',{getItem:k=>disk.get(k)??null,setItem:(k,v)=>{disk.set(k,v);}})});
 const calls:any[]=[];let refreshed=0;const client={...local,authorizationContext:()=> 'caller-scope',mutate:async(input:any)=>{calls.push(input);return {data:{legacyData:{mutate:{affected:1,rowCount:1,version:2,generation:1}}},extensions:{outcomes:{'legacyData.mutate':'committed'}}};}};
 const store:any={};const node=()=>({setAttribute(){},append(){},replaceChildren(){},addEventListener(){},textContent:''});
 new Function('client','gql','createSignal','createCompiledDatasetMutations','createCompiledMutationAvailability','compiledMutationIntentStore','values','write','declarations','run','document','window','store',datasetMutationBoot([{name:'restore',backendNamespace:'legacyData',recoveryScope:'a'.repeat(64),paramTypes:{}}],false))(client,gql,(initial:number)=>{let value=initial;return [()=>value,(fn:any)=>{value=fn(value);}];},createCompiledDatasetMutations,createCompiledMutationAvailability,compiledMutationIntentStore,()=>({}),()=>{},[],()=>{refreshed++;},{createElement:node,body:{append(){}}},{addEventListener(){}},store);
 const result=await store.mutate('restore');assert.equal(result.affected,1);assert.equal(calls.length,1);assert.equal(calls[0].variables.operation,'restore');assert.equal(refreshed,1);
 await assert.rejects(store.mutate('missing'));assert.equal(calls.length,1);
});
