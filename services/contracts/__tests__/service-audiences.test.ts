/**
 * IDENTITY__SERVICE_AUDIENCES: validate opt-ins and report removed keys without retaining or revealing their values.
 */
import {describe,expect,it} from 'vitest';
import {parseServiceAudiences} from '../src/service-audiences';

const BASE={id:'warehouse',origin:'https://warehouse.example',introspection_secret_sha256:'a'.repeat(64),artifact_reads:true,run_sign_ins:true,group_sign_ins:true,group_principals:true};
const WORKLOADS={authorization_url:'https://worker.example/authorize',authorization_secret:'synthetic-callback-secret'};
const parse=(entries:unknown)=>{const told:[string,readonly string[]][]=[];return {audiences:parseServiceAudiences(JSON.stringify(entries),(id,keys)=>told.push([id,keys])),told};};

describe('a removed key',()=>{
 it('is accepted and ignored, whatever it holds, and named once per entry that carries it',()=>{
  const plain=parseServiceAudiences(JSON.stringify([BASE,{id:'crm',origin:'https://crm.example'}]));
  for(const value of [WORKLOADS,{},null,'anything',42]){
   const {audiences,told}=parse([{...BASE,artifact_workloads:value},{id:'crm',origin:'https://crm.example'}]);
   expect(audiences).toEqual(plain);
   expect(told).toEqual([['warehouse',['artifact_workloads']]]);
   expect(JSON.stringify(audiences)+JSON.stringify(told)).not.toContain('synthetic-callback-secret');
  }
  expect(plain[0]).toEqual({id:'warehouse',origin:'https://warehouse.example',introspectionSecretSha256:'a'.repeat(64),artifactReads:true,runSignIns:true,groupSignIns:true,groupPrincipals:true});
  // Told nothing for a setting without one.
  expect(parse([BASE]).told).toEqual([]);
 });
 it('keeps refusing an unknown key, and an invalid setting tells nothing of what it carried',()=>{
  for(const entries of [[{...BASE,artifact_workload:true}],[{...BASE,artifact_workloads:WORKLOADS,surprise:1}],[{...BASE,artifact_reads:'yes',artifact_workloads:WORKLOADS}],[{...BASE,artifact_workloads:WORKLOADS},{...BASE}]]){
   const told:string[]=[];
   expect(()=>parseServiceAudiences(JSON.stringify(entries),id=>told.push(id))).toThrow(/IDENTITY__SERVICE_AUDIENCES/);
   expect(told).toEqual([]);
  }
 });
});

describe('service opt-ins that require a secret', () => {
  it.each([
    { key: 'group_principals', property: 'groupPrincipals', origin: 'https://warehouse.example' },
    { key: 'run_sign_ins', property: 'runSignIns', origin: 'https://warehouse.example' },
    { key: 'group_sign_ins', property: 'groupSignIns', origin: 'http://warehouse.localhost:7444' },
  ])('parses $key only as an explicit boolean and requires a secret when enabled', ({ key, property, origin }) => {
    const service = { id: 'warehouse', origin };
    const withSecret = { ...service, introspection_secret_sha256: 'a'.repeat(64) };

    expect(parse([withSecret]).audiences[0]).not.toHaveProperty(property);
    expect(parse([{ ...withSecret, [key]: false }]).audiences[0]).not.toHaveProperty(property);
    expect(parse([{ ...withSecret, [key]: true }]).audiences[0]).toHaveProperty(property, true);

    expect(() => parse([{ ...withSecret, [key]: 'yes' }])).toThrow(/IDENTITY__SERVICE_AUDIENCES/);
    expect(() => parse([{ ...service, [key]: true }])).toThrow(/IDENTITY__SERVICE_AUDIENCES/);
  });
});
