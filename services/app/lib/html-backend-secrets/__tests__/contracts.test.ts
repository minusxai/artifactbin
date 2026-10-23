import {describe,it,expect} from 'vitest';
import {createBackendSecrets,secretBindingNames,type BackendSecretRepository} from '../contracts';
describe('backend credential boundaries',()=>{
 it('validates explicit unique bounded names',()=>{expect(secretBindingNames(undefined)).toEqual([]);expect(secretBindingNames(['TOKEN'])).toEqual(['TOKEN']);for(const names of [['TOKEN','TOKEN'],['token'],['A-B'],Array(33).fill('TOKEN')])expect(()=>secretBindingNames(names)).toThrow();});
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
