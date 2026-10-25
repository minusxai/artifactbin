import {describe,it,expect} from 'vitest';
import {createRegisteredMutationService,validateMutationProgram} from '../index';
import type {RegisteredMutationPlan,RegisteredMutationPorts,MutationContext,RegisteredMutationOutcome} from '../contracts';
const digest='a'.repeat(64);
const context:MutationContext={pageId:'page',pageVersion:1,backendId:'backend',backendVersion:digest,sourceSha256:digest,subject:'caller',callerKey:'credential'};
const plan:RegisteredMutationPlan={registration:{pageId:context.pageId,pageVersion:context.pageVersion,backendId:context.backendId,backendVersion:context.backendVersion,sourceSha256:context.sourceSha256},name:'save',kind:'insert',sql:'INSERT INTO forms.rows(body) VALUES ($body)',target:{datasetId:'dataset',schema:'forms',table:'rows'},values:{body:{type:'string',nullable:false,parameter:'body'}},builtins:[{name:'_me.id',parameter:'me'}],expectedAffected:1,reset:['body']};
function harness(){const events:string[]=[],receipts=new Map<string,{fingerprint:string;outcome:RegisteredMutationOutcome}>();let commits=0;let result:{outcome:'committed'|'rejected'|'unknown';revision:string|null;affected:number|null}={outcome:'committed',revision:'2',affected:1};const ports:RegisteredMutationPorts={authorize:async()=>{events.push('authorize');},platform:async()=>({userId:'server-user',now:'2026-01-01T00:00:00.000Z',tz:'UTC'}),durable:async(_context,key,fingerprint,work)=>{const prior=receipts.get(key);if(prior){if(prior.fingerprint!==fingerprint)throw Error('idempotency_mismatch');return prior.outcome;}const outcome=await work({});receipts.set(key,{fingerprint,outcome});return outcome;},commit:async(_context,_plan,params)=>{events.push('commit');commits++;expect(params.me).toBe('server-user');return result;}};return {ports,events,setResult:(value:typeof result)=>result=value,commits:()=>commits};}
describe('registered immutable page mutations',()=>{
 it('authorizes before durable lookup, binds server actor and replays committed receipt without another write',async()=>{const h=harness(),run=createRegisteredMutationService(h.ports),input={requestId:'request_1234567890',values:{body:'Hello'}};const first=await run(context,plan,input,new AbortController().signal);expect(first).toEqual({requestId:input.requestId,outcome:'committed',revision:'2',affected:1,reset:['body']});expect(await run(context,plan,input,new AbortController().signal)).toEqual(first);expect(h.commits()).toBe(1);expect(h.events).toEqual(['authorize','authorize','commit','authorize']);});
 it('rejects client SQL, actor, dataset and undeclared/type-confused values before execution',async()=>{for(const input of [{requestId:'request_1234567890',values:{body:3}},{requestId:'request_1234567890',values:{body:'x',actor:'spoof'}},{requestId:'request_1234567890',values:{body:'x'},sql:'DELETE'},{requestId:'short',values:{body:'x'}}]){const h=harness();await expect(createRegisteredMutationService(h.ports)(context,plan,input,new AbortController().signal)).rejects.toThrow();expect(h.commits()).toBe(0);}});
 it('never resets rejected/unknown writes and preserves the same operation identity',async()=>{for(const outcome of ['rejected','unknown'] as const){const h=harness();h.setResult({outcome,revision:null,affected:null});const result=await createRegisteredMutationService(h.ports)(context,plan,{requestId:'request_1234567890',values:{body:'x'}},new AbortController().signal);expect(result.reset).toEqual([]);expect(result.outcome).toBe(outcome);}});
 it('rejects stale page/source identity and conflicting same-key values',async()=>{const h=harness(),run=createRegisteredMutationService(h.ports),signal=new AbortController().signal;await expect(run({...context,pageVersion:2},plan,{requestId:'request_1234567890',values:{body:'x'}},signal)).rejects.toThrow();await run(context,plan,{requestId:'request_1234567890',values:{body:'x'}},signal);await expect(run(context,plan,{requestId:'request_1234567890',values:{body:'y'}},signal)).rejects.toThrow('idempotency_mismatch');});
 it('scopes request identities by credential and operation, not only public request IDs',async()=>{const h=harness(),run=createRegisteredMutationService(h.ports),input={requestId:'request_1234567890',values:{body:'x'}},signal=new AbortController().signal;await run(context,plan,input,signal);await run({...context,callerKey:'other-credential'},plan,input,signal);await run(context,{...plan,name:'other'},input,signal);expect(h.commits()).toBe(3);});
 it('reports exact supported pilot shapes and refuses unsupported registration rather than silently omitting',()=>{expect(()=>validateMutationProgram(plan)).not.toThrow();expect(()=>validateMutationProgram({...plan,expectedAffected:2})).not.toThrow();expect(()=>validateMutationProgram({...plan,kind:'update'})).not.toThrow();for(const expectedAffected of [-1,0.5,NaN])expect(()=>validateMutationProgram({...plan,expectedAffected})).toThrow();});
});

it('retains compiler SQL parameter identifiers for row arguments and server actor/clock bindings',async()=>{
 const h=harness(),registered:RegisteredMutationPlan={...plan,sql:'INSERT INTO forms.rows(body) SELECT $_row__id WHERE $_me__id IS NOT NULL AND $_now IS NOT NULL',values:{row_id:{type:'string',nullable:false,parameter:'_row__id'}},builtins:[{name:'_me.id',parameter:'_me__id'},{name:'_now',parameter:'_now'}],reset:[]};
 let observed:unknown;
 h.ports.commit=async(_context,_plan,params)=>{observed=params;return {outcome:'committed',revision:'2',affected:1};};
 await createRegisteredMutationService(h.ports)(context,registered,{requestId:'request_compiler_1234',values:{row_id:'retained-row'}},new AbortController().signal);
 expect(observed).toEqual({_row__id:'retained-row',_me__id:'server-user',_now:'2026-01-01T00:00:00.000Z'});
 expect(()=>validateMutationProgram({...registered,name:'_hidden'})).toThrow('unsupported_registered_mutation');
 expect(()=>validateMutationProgram({...registered,values:{row_id:{type:'string',nullable:false,parameter:'_row.id'}}})).toThrow('unsupported_registered_mutation');
});

it('preserves explicit and absent affected-row contracts, accepting zero or multiple committed rows only when declared',async()=>{
 for(const affected of [0,2]){const h=harness();h.setResult({outcome:'committed',revision:'2',affected});const unrestricted={...plan};delete unrestricted.expectedAffected;const result=await createRegisteredMutationService(h.ports)(context,unrestricted,{requestId:'request_count_123456',values:{body:'x'}},new AbortController().signal);expect(result).toMatchObject({affected,reset:['body']});}
 const h=harness();h.setResult({outcome:'committed',revision:'2',affected:2});await expect(createRegisteredMutationService(h.ports)(context,plan,{requestId:'request_count_123456',values:{body:'x'}},new AbortController().signal)).rejects.toThrow('invalid_committed_mutation_receipt');
});

 it('replays only declared bounded conflict reasons and never leaks other refusal diagnostics',async()=>{
  for(const reason of ['row_changed','row_not_unique','private SQL detail'] as const){
   const h=harness();h.ports.commit=async()=>{return {outcome:'rejected',revision:null,affected:null,reason} as Awaited<ReturnType<RegisteredMutationPorts['commit']>>;};
   const run=createRegisteredMutationService(h.ports),input={requestId:'request_reason_123456',values:{body:'x'}},registered={...plan,refusalReasons:'conflict-v1' as const};
   const first=await run(context,registered,input,new AbortController().signal);
   expect(first.reason).toBe(reason==='private SQL detail'?undefined:reason);
   expect(await run(context,registered,input,new AbortController().signal)).toEqual(first);
   expect(first.reset).toEqual([]);
  }
  const h=harness();h.ports.commit=async()=>({outcome:'rejected',revision:null,affected:null,reason:'row_changed'});
  expect(await createRegisteredMutationService(h.ports)(context,plan,{requestId:'request_legacy_123456',values:{body:'x'}},new AbortController().signal)).not.toHaveProperty('reason');
 });
