/**
 * IDENTITY__SERVICE_AUDIENCES across a removal: an entry that still carries a removed feature's key parses as the same
 * entry without it, the caller hears the entry's id and the key (never its value), and every other check holds.
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
