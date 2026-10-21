import test from 'node:test';
import assert from 'node:assert/strict';
import {planMigrationIdentities} from '../src/migration/identities.ts';
import {emailAddress} from '../src/email.ts';
import {passwordAccount,newPasswordAccount,identityCrypto} from '../src/server/identity-policy.ts';
import type {MigrationManifest} from '../src/migration/contracts.ts';
const manifest=(users:Record<string,unknown>[]):MigrationManifest=>({schemaVersion:1,sourceNamespace:'fixture',exportedAt:'',artifacts:[],tokenOwners:[],tables:{users}});
test('empty-email existing identities receive deterministic nonlogin actors without credentials or handles',()=>{
 const m=manifest([{id:'u1',email:null,name:'Fixture',username:'fixture-user'}]);m.tokenOwners=[{id:'token',user_id:'u1'}];
 const a=planMigrationIdentities(m);const b=planMigrationIdentities(m);const actor=a.maps.users.u1!;
 assert.equal(actor,b.maps.users.u1);assert.match(actor,/^legacy-user:[a-f0-9]{64}$/);assert.equal(a.maps.tokens.token,actor);assert.equal(a.identities[0]?.classification,'preserved-nonlogin');
 assert.throws(()=>emailAddress(actor));assert.throws(()=>newPasswordAccount(actor,'long-enough-password',identityCrypto));assert.throws(()=>passwordAccount({},'any-password',identityCrypto));
});
test('invalid nonempty emails and duplicate legacy identity keys remain blocked',()=>{
 const p=planMigrationIdentities(manifest([{id:'invalid',email:'invalid'},{id:'duplicate',email:null},{id:'duplicate',email:null},{id:'email',email:' Owner@Example.test '}]));
 assert.equal(p.maps.users.invalid,undefined);assert.equal(p.maps.users.duplicate,undefined);assert.equal(p.maps.users.email,'owner@example.test');assert.equal(p.identities.filter(i=>i.classification==='blocked').length,3);
});

test('authentication services cannot issue sessions for preserved nonlogin actors',async()=>{
 const {createAuthenticationService}=await import('../src/server/authentication.ts');
 const {createIdentityAuthority}=await import('../src/server/identity.ts');
 const actor=planMigrationIdentities(manifest([{id:'u',email:null}])).maps.users.u!;let issued=0;let emailed=0;
 const repository={
  async withPasswordAccount(_actor:string,operation:(context:{account:{}})=>unknown){return operation({account:{}});},
  async withEmailChallenge(){throw new Error('Reserved actor must fail before email lookup');},
 } as unknown as import('../src/server/identity-repository-contracts.ts').IdentityRepository;
 const service=createAuthenticationService({repository,authority:{...createIdentityAuthority(),issue:()=>{issued++;throw new Error('No session may be issued');}},sendCode:async()=>{emailed++;}});
 await assert.rejects(service.execute({kind:'password',username:actor,password:'any-password',peer:'fixture'}),/Incorrect username or password/);
 await assert.rejects(service.execute({kind:'request-code',email:actor}),/valid email/);
 await assert.rejects(service.execute({kind:'verify-code',email:actor,code:'123456'}),/valid email/);
 assert.equal(issued,0);assert.equal(emailed,0);
});

test('production service refuses the development test-token entrypoint',async()=>{
 const {createService}=await import('../src/server.js');
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
 try{assert.throws(()=>createService({testLogin:true}),/cannot run in production/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
