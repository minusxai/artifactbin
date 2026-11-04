import {describe,it,expect} from 'vitest';
import {RESOLVER_DATABASE_KINDS} from '@artifactbin/contracts';
import {createBackendSecrets,databaseConnection,secretBindingNames,secretHostMap,type BackendSecretRepository} from '../contracts';
describe('backend credential boundaries',()=>{
 it('validates explicit unique bounded names',()=>{expect(secretBindingNames(undefined)).toEqual([]);expect(secretBindingNames(['TOKEN'])).toEqual(['TOKEN']);for(const names of [['TOKEN','TOKEN'],['token'],['A-B'],Array(33).fill('TOKEN')])expect(()=>secretBindingNames(names)).toThrow();});
 it('binds each declared secret name to one host, exact or one leading wildcard label, and never accepts values',()=>{
  expect(secretHostMap(undefined)).toEqual({});
  expect(secretHostMap({SHEETS_KEY:'sheets.googleapis.com',SNOWFLAKE_PAT:'*.snowflakecomputing.com'})).toEqual({SHEETS_KEY:'sheets.googleapis.com',SNOWFLAKE_PAT:'*.snowflakecomputing.com'});
  expect(Object.keys(secretHostMap({ZED:'a.example.com',API:'b.example.com'}))).toEqual(['API','ZED']);
  for(const hosts of [['sheets.googleapis.com'],'SHEETS_KEY',null,{lower:'a.example.com'},{'A-B':'a.example.com'},Object.fromEntries(Array.from({length:33},(_,i)=>['K'+i,'a.example.com']))])expect(()=>secretHostMap(hosts)).toThrow('invalid_secrets');
  for(const host of ['','localhost','https://a.example.com','a.example.com/path','a.example.com:8443','A.Example.com','*.com','**.example.com','a.*.example.com','*example.com','127.0.0.1','sk_live_0123456789abcdef',' a.example.com','-a.example.com',1,null])expect(()=>secretHostMap({KEY:host})).toThrow('invalid_secrets');
 });
 it('binds a name to a database kind of the one list, postgres or mysql, and no other non-host word',()=>{
  expect(RESOLVER_DATABASE_KINDS).toEqual(['postgres','mysql']);
  expect(secretHostMap({WAREHOUSE:'postgres',SHOP:'mysql',API:'api.example.com'})).toEqual({API:'api.example.com',SHOP:'mysql',WAREHOUSE:'postgres'});
  for(const host of ['Postgres','postgres:','postgresql','MySQL','mariadb','mssql','sqlite','*.postgres','*.mysql'])expect(()=>secretHostMap({KEY:host})).toThrow('invalid_secrets');
  // An unknown type is refused by name, with the supported ones: publish shows this message as is.
  expect(()=>secretHostMap({DB:'mssql'})).toThrow('invalid_secrets: DB: "mssql" is neither a host name (exact or one leading *. label) nor a database type (postgres, mysql)');
  expect(()=>secretHostMap({DB:5432})).toThrow('invalid_secrets: DB: number is neither');
 });
 it('validates and normalizes a stored database connection, its kind one of the list',()=>{
  const ok={kind:'postgres',host:'DB.Example.com',port:5432,database:'shop',user:'reader',password:'p@ss word'};
  expect(databaseConnection(ok)).toEqual({...ok,host:'db.example.com',tls:'verify-full'});
  expect(databaseConnection({...ok,kind:'mysql',port:3306})).toEqual({...ok,kind:'mysql',port:3306,host:'db.example.com',tls:'verify-full'});
  for(const kind of [undefined,'','Postgres','postgresql','mssql',1])expect(()=>databaseConnection({...ok,kind}),String(kind)).toThrow('invalid_connection');
  expect(databaseConnection({...ok,tls:'disable'}).tls).toBe('disable');
  const ca='-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';expect(databaseConnection({...ok,ca}).ca).toBe(ca);
  for(const bad of [null,[],'x',{...ok,extra:1},{...ok,host:'2130706433'},{...ok,host:'0x7f.1'},{...ok,host:'127.1'},{...ok,host:'postgres'},{...ok,host:'db.example.com:5432'},
   {...ok,port:22},{...ok,port:1023},{...ok,port:65536},{...ok,port:'5432'},{...ok,database:''},{...ok,user:'a\nb'},{...ok,password:''},{...ok,password:'x'.repeat(1025)},
   {...ok,tls:'require'},{...ok,ca:'not a pem'},{...ok,ca:'-----BEGIN CERTIFICATE-----'+'x'.repeat(13000)}])
   expect(()=>databaseConnection(bad),JSON.stringify(bad)?.slice(0,80)).toThrow('invalid_connection');
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
  await secrets.putConnection(scope,'WAREHOUSE','postgres',{host:'db.example.com',port:6543,database:'d',user:'u',password:'conn-pass'});
  expect(JSON.parse(await secrets.get(scope,['WAREHOUSE'],'WAREHOUSE'))).toEqual({kind:'postgres',host:'db.example.com',port:6543,database:'d',user:'u',password:'conn-pass',tls:'verify-full'});
  await expect(secrets.putConnection(scope,'WAREHOUSE','postgres',{host:'10.0.0.1x',port:6543})).rejects.toThrow('invalid_connection');
  // The declared kind is the stored one: a body naming another is refused.
  await expect(secrets.putConnection(scope,'WAREHOUSE','postgres',{kind:'mysql',host:'db.example.com',port:3306,database:'d',user:'u',password:'conn-pass'})).rejects.toThrow('invalid_connection');
  await secrets.putConnection(scope,'WAREHOUSE','mysql',{kind:'mysql',host:'db.example.com',port:3306,database:'d',user:'u',password:'conn-pass'});
  expect(JSON.parse(await secrets.get(scope,['WAREHOUSE'],'WAREHOUSE')).kind).toBe('mysql');
  expect(JSON.stringify(await secrets.names(scope))).not.toContain('conn-pass');
  await secrets.remove(scope,'WAREHOUSE');
  await secrets.put(scope,'TOKEN','rotated');expect(await secrets.get(scope,['TOKEN'],'TOKEN')).toBe('rotated');await secrets.remove(scope,'TOKEN');await expect(secrets.get(scope,['TOKEN'],'TOKEN')).rejects.toThrow('unavailable');
 });
});
