import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedBackendEnv, validSecretName, validSecretValue, BACKEND_ENV_MAX_VALUE_BYTES } from '../../../src/backend/container/env-policy.mjs';

test('secret names and UTF-8 values have one bounded text-binding policy',()=>{
 for(const name of ['A','A_1','Z'.repeat(64)])assert.equal(validSecretName(name),true);
 for(const name of ['', 'a', '1A','A-B','A\n','A'.repeat(65),'__proto__',null])assert.equal(validSecretName(name),false);
 for(const value of ['a','\t\r\n','é'.repeat(2048),'😀'.repeat(1024)])assert.equal(validSecretValue(value),true);
 for(const value of ['', 'a\0b','é'.repeat(2049),'😀'.repeat(1025),1,null])assert.equal(validSecretValue(value),false);
});

test('the environment is a sorted defensive copy with exact count and total value bounds',()=>{
 const input={Z:'last',A:'first'};const out=checkedBackendEnv(input);
 assert.deepEqual(Object.keys(out),['A','Z']);input.A='changed';assert.equal(out.A,'first');
 assert.deepEqual(checkedBackendEnv(Object.create(null)),{});
 const maximum=Object.fromEntries(Array.from({length:64},(_,i)=>['K'+i,'é'.repeat(2048)]));
 assert.equal(Object.values(checkedBackendEnv(maximum)).reduce((n,v)=>n+Buffer.byteLength(v),0),BACKEND_ENV_MAX_VALUE_BYTES);
 assert.throws(()=>checkedBackendEnv({...maximum,EXTRA:'x'}),TypeError);
 for(const bad of [{KEY:'a\0b'},{bad:'value'},{KEY:''},{KEY:'é'.repeat(2049)},{KEY:42}])assert.throws(()=>checkedBackendEnv(bad),TypeError);
});

test('non-JSON prototypes, symbols and hidden/accessor properties fail without executing user code',()=>{
 let reads=0;const accessor=Object.defineProperty({},'KEY',{enumerable:true,get(){reads++;return 'secret';}});
 const hidden=Object.defineProperty({},'KEY',{value:'secret'});
 for(const bad of [null,[],new String('x'),Object.create({KEY:'inherited'}),accessor,hidden,{[Symbol('key')]:'value'},new Date()])assert.throws(()=>checkedBackendEnv(bad),TypeError);
 assert.equal(reads,0);
});
