import test from 'node:test';
import assert from 'node:assert/strict';
import {authorApolloPorts} from '../src/migration/conversion/compiled/author/apollo-ports.ts';
test('local author mutations work without granting denied remote mutation access',async()=>{
 const calls:string[]=[];
 const ports=authorApolloPorts({} as any,{} as any,()=>({}) as any,{names:['remote'],adapter:{mutate:async()=>{calls.push('remote');return {} as any;}},authorizationContext:()=>null},{names:['inc','add'],mutate:async name=>{calls.push(name);return true;}});
 await ports.mutation!('inc',{});await ports.mutation!('add',{});
 await assert.rejects(ports.mutation!('remote',{}),/context unavailable/);
 await assert.rejects(ports.mutation!('unknown',{}),/Unregistered/);
 const signal=AbortSignal.abort();await assert.rejects(ports.mutation!('inc',{},undefined,signal),/disposed/);
 assert.deepEqual(calls,['inc','add']);
});
