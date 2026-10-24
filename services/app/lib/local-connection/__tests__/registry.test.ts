import {describe,it,expect} from 'vitest';
import {createConnectionRegistry} from '../registry';
import {LocalConnectionError,type LinkedDocument} from '../contracts';
const identity:LinkedDocument={platformOrigin:'https://platform.example',artifactId:'page123',baseRevision:'2',sourceDigest:'a'.repeat(64)};
describe('document scoped connection authority',()=>{
 it('binds grants to the document and current actor and rechecks permission',async()=>{
  let actor='alice',allowed=true;const registry=createConnectionRegistry({random:()=> 'cap',inspect:async identity=>{if(!allowed)throw new LocalConnectionError('unavailable');return {identity,actor,role:'writer'};}});
  const grant=await registry.grant(identity);expect(grant.capability).toBe('cap');
  await expect(registry.authorize('cap','different')).rejects.toMatchObject({code:'revoked'});
  expect((await registry.authorize('cap',identity.artifactId)).actor).toBe('alice');
  actor='bob';await expect(registry.authorize('cap',identity.artifactId)).rejects.toMatchObject({code:'revoked'});
  actor='alice';await expect(registry.authorize('cap',identity.artifactId)).rejects.toMatchObject({code:'revoked'});
  await registry.grant(identity);allowed=false;await expect(registry.authorize('cap',identity.artifactId)).rejects.toMatchObject({code:'unavailable'});
 });
 it('expires, cancels and bounds admission, including concurrent pending inspections',async()=>{
  let now=0;let next=0;let release:()=>void=()=>{};const wait=new Promise<void>(r=>{release=r;});
  const registry=createConnectionRegistry({now:()=>now,random:()=>String(++next),ttl:10,capacity:1,inspect:async identity=>{await wait;return {identity,actor:'guest',role:'reader'};}});
  const pending=registry.grant(identity);await expect(registry.grant(identity)).rejects.toMatchObject({code:'capacity'});release();const grant=await pending;
  now=10;await expect(registry.authorize(grant.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});
  const fresh=await registry.grant(identity);registry.revoke(fresh.capability);await expect(registry.authorize(fresh.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});
 });
 it('refuses identity changes and never renews authority merely by using it',async()=>{
  let now=0;let changed=false;
  const registry=createConnectionRegistry({now:()=>now,ttl:10,random:()=> 'cap',inspect:async input=>({identity:changed?{...input,baseRevision:'3'}:input,actor:'alice',role:'writer'})});
  await registry.grant(identity);changed=true;await expect(registry.authorize('cap',identity.artifactId)).rejects.toMatchObject({code:'stale'});
  changed=false;await registry.grant(identity);now=9;await registry.authorize('cap',identity.artifactId);now=10;await expect(registry.authorize('cap',identity.artifactId)).rejects.toMatchObject({code:'revoked'});
 });
});
