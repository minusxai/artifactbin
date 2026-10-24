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
it('observes changed heads without retaining write authority and refuses changed account or role metadata',async()=>{
 let revision='2',actor='alice',role='writer',next=0;
 const registry=createConnectionRegistry({random:()=>String(++next),inspect:async input=>({identity:{...input,baseRevision:revision},actor,role})});
 const first=await registry.grant(identity);revision='3';const observed=await registry.status(first.capability,identity.artifactId);expect(observed.compatible).toBe(false);expect(observed.admission.identity.baseRevision).toBe('3');
 await expect(registry.authorize(first.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});
 revision='2';const second=await registry.grant(identity);actor='bob';revision='3';await expect(registry.status(second.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});
 actor='alice';revision='2';const third=await registry.grant(identity);role='viewer';await expect(registry.status(third.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});
});
it('renews only live compatible leases for the original actor and never revives an expired grant',async()=>{
 let now=0,actor='alice',revision='2',advanceDuringInspection=false,next=0;
 const registry=createConnectionRegistry({now:()=>now,ttl:10,random:()=>String(++next),inspect:async input=>{if(advanceDuringInspection)now++;return {identity:{...input,baseRevision:revision},actor,role:'writer'};}});
 const active=await registry.grant(identity);now=9;expect((await registry.status(active.capability,identity.artifactId)).compatible).toBe(true);
 now=18;await registry.authorize(active.capability,identity.artifactId);now=19;await expect(registry.status(active.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});
 now=20;const boundary=await registry.grant(identity);now=29;advanceDuringInspection=true;await expect(registry.status(boundary.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});advanceDuringInspection=false;
 now=40;const changed=await registry.grant(identity);now=49;actor='bob';await expect(registry.status(changed.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});actor='alice';await expect(registry.status(changed.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});
 now=60;const source=await registry.grant(identity);now=69;revision='3';expect((await registry.status(source.capability,identity.artifactId)).compatible).toBe(false);await expect(registry.authorize(source.capability,identity.artifactId)).rejects.toMatchObject({code:'revoked'});
});
