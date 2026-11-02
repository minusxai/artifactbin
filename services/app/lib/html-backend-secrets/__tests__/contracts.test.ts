import {describe,it,expect} from 'vitest';
import {createBackendSecrets,secretBindingNames,secretHostMap,type BackendSecretRepository} from '../contracts';
describe('backend credential boundaries',()=>{
 it('validates explicit unique bounded names',()=>{expect(secretBindingNames(undefined)).toEqual([]);expect(secretBindingNames(['TOKEN'])).toEqual(['TOKEN']);for(const names of [['TOKEN','TOKEN'],['token'],['A-B'],Array(33).fill('TOKEN')])expect(()=>secretBindingNames(names)).toThrow();});
 it('binds each declared secret name to one host, exact or one leading wildcard label, and never accepts values',()=>{
  expect(secretHostMap(undefined)).toEqual({});
  expect(secretHostMap({SHEETS_KEY:'sheets.googleapis.com',SNOWFLAKE_PAT:'*.snowflakecomputing.com'})).toEqual({SHEETS_KEY:'sheets.googleapis.com',SNOWFLAKE_PAT:'*.snowflakecomputing.com'});
  expect(Object.keys(secretHostMap({ZED:'a.example.com',API:'b.example.com'}))).toEqual(['API','ZED']);
  for(const hosts of [['sheets.googleapis.com'],'SHEETS_KEY',null,{lower:'a.example.com'},{'A-B':'a.example.com'},Object.fromEntries(Array.from({length:33},(_,i)=>['K'+i,'a.example.com']))])expect(()=>secretHostMap(hosts)).toThrow('invalid_secrets');
  for(const host of ['','localhost','https://a.example.com','a.example.com/path','a.example.com:8443','A.Example.com','*.com','**.example.com','a.*.example.com','*example.com','127.0.0.1','sk_live_0123456789abcdef',' a.example.com','-a.example.com',1,null])expect(()=>secretHostMap({KEY:host})).toThrow('invalid_secrets');
 });
 it('isolates owners and backend files, rechecks revocation, and exposes names only',async()=>{
  const rows=new Map<string,string>();const key=(s:{ownerId:string;backendId:string},n:string)=>JSON.stringify([s.ownerId,s.backendId,n]);
  const repo:BackendSecretRepository={get:async(s,n)=>rows.get(key(s,n))??null,put:async(s,n,v)=>{rows.set(key(s,n),v);},remove:async(s,n)=>{rows.delete(key(s,n));},names:async s=>[...rows.keys()].map(k=>JSON.parse(k)).filter(([o,b])=>o===s.ownerId&&b===s.backendId).map(([, ,n])=>n)};
  const secrets=createBackendSecrets(repo,{seal:v=>'encrypted:'+v,open:v=>v.slice(10)}),scope={ownerId:'owner',backendId:'backend'};
  await secrets.put(scope,'TOKEN','private-value');expect(await secrets.get(scope,['TOKEN'],'TOKEN')).toBe('private-value');
  expect(await secrets.names(scope)).toEqual(['TOKEN']);expect(JSON.stringify(await secrets.names(scope))).not.toContain('private-value');
  await expect(secrets.get(scope,[],'TOKEN')).rejects.toThrow('forbidden');
  await expect(secrets.get({...scope,ownerId:'other'},['TOKEN'],'TOKEN')).rejects.toThrow('unavailable');
  await expect(secrets.get({...scope,backendId:'other'},['TOKEN'],'TOKEN')).rejects.toThrow('unavailable');
  await secrets.put(scope,'TOKEN','rotated');expect(await secrets.get(scope,['TOKEN'],'TOKEN')).toBe('rotated');await secrets.remove(scope,'TOKEN');await expect(secrets.get(scope,['TOKEN'],'TOKEN')).rejects.toThrow('unavailable');
 });
});
