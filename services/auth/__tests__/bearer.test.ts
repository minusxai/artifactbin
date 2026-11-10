import {afterAll,beforeEach,describe,expect,it} from 'vitest';
import type {Queryable} from '@artifactbin/contracts';
import {createBearerReader} from '../src/identity/bearer';
import {createOAuthStore} from '../src/identity/oauth';
import {mintTestToken,resetTestDb,testDb} from './helpers';

const db:Queryable={query:(sql,params)=>testDb().query(sql,params)};
const store=()=>createOAuthStore(db,'auth');
const oauth=async(id:string)=>{
 const token=await mintTestToken({id,userId:'usr_1',query:testDb().query});
 await testDb().query("UPDATE tokens SET audience='http://app.test/api',scope='artifacts' WHERE id=$1",[id]);
 return token;
};
const member=(accessTokenId:string)=>store().issueRefresh({clientId:'client',userId:'usr_1',resource:'http://app.test/api',scope:'artifacts',accessTokenId});

beforeEach(async()=>{
 await resetTestDb();
 await testDb().query('DELETE FROM auth."user"');
 await testDb().query(`INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES('usr_1','One','one@example.com',true),('usr_2','Two','two@example.com',false)`);
});
afterAll(async()=>{await testDb().pg().close();});

describe('createBearerReader',()=>{
 it('reads a CLI token with its account identity',async()=>{
  const token=await mintTestToken({id:'tok_cli',userId:'usr_1',query:testDb().query});
  expect(await createBearerReader({db}).byToken(token)).toEqual({id:'tok_cli',userId:'usr_1',email:'one@example.com',emailVerified:true});
  const unverified=await mintTestToken({id:'tok_two',userId:'usr_2',query:testDb().query});
  expect(await createBearerReader({db}).byToken(unverified)).toEqual({id:'tok_two',userId:'usr_2',email:'two@example.com',emailVerified:false});
 });

 it('reads a token whose user has no account row without an identity',async()=>{
  const token=await mintTestToken({id:'tok_tu',userId:'tu_disposable',query:testDb().query});
  expect(await createBearerReader({db}).byToken(token)).toEqual({id:'tok_tu',userId:'tu_disposable'});
 });

 it('refuses a malformed value before it reaches the database',async()=>{
  let queried=0;
  const reader=createBearerReader({db:{query:async()=>{queried++;return {rows:[]};}}});
  for(const value of ['','mx_short','Bearer mx_'+'x'.repeat(40),'mx_'+'x'.repeat(40)+' OR 1=1'])expect(await reader.byToken(value)).toBeNull();
  expect(queried).toBe(0);
 });

 it('refuses deleted, expired and unknown tokens',async()=>{
  const reader=createBearerReader({db});
  const deleted=await mintTestToken({id:'tok_deleted',userId:'usr_1',query:testDb().query});
  const expired=await mintTestToken({id:'tok_expired',userId:'usr_1',query:testDb().query});
  await testDb().query("UPDATE tokens SET deleted_at=now() WHERE id='tok_deleted'");
  await testDb().query("UPDATE tokens SET expires_at=now()-interval '1 second' WHERE id='tok_expired'");
  expect(await reader.byToken(deleted)).toBeNull();
  expect(await reader.byToken(expired)).toBeNull();
  expect(await reader.byToken('mx_'+'u'.repeat(40))).toBeNull();
 });

 it('admits an OAuth token only through a live family: revoked family, revoked or orphaned sibling, or no membership refuse it',async()=>{
  const reader=createBearerReader({db});
  expect(await reader.byToken(await oauth('tok_unpublished'))).toBeNull();
  const live=await oauth('tok_live');const refresh=await member('tok_live');
  expect(await reader.byToken(live)).toEqual({id:'tok_live',userId:'usr_1',audience:'http://app.test/api',scope:'artifacts',email:'one@example.com',emailVerified:true});
  await store().revokeRefresh(refresh,'client');
  expect(await reader.byToken(live)).toBeNull();

  const sibling=await oauth('tok_sibling');await member('tok_sibling');
  expect(await reader.byToken(sibling)).not.toBeNull();
  await testDb().query("UPDATE auth.credentials SET deleted_at=now() WHERE kind='refresh_token' AND payload->>'access_token_id'='tok_sibling'");
  expect(await reader.byToken(sibling)).toBeNull();

  const orphan=await oauth('tok_orphan');await member('tok_orphan');
  const group=(await testDb().query<{group_id:string}>("SELECT group_id FROM auth.credentials WHERE kind='refresh_token' AND payload->>'access_token_id'='tok_orphan'")).rows[0]!.group_id;
  await testDb().query("INSERT INTO auth.credentials(kind,credential_hash,group_id,payload,expires_at) VALUES('refresh_token','orphan-member',$1,jsonb_build_object('access_token_id','tok_gone'),now()+interval '1 day')",[group]);
  expect(await reader.byToken(orphan)).toBeNull();
 });

 it('reads by token id with the same liveness: deleted, expired, a revoked OAuth family and admission all refuse',async()=>{
  const reader=createBearerReader({db});
  await mintTestToken({id:'tok_by_id',userId:'usr_1',query:testDb().query});
  expect(await reader.byId!('tok_by_id')).toEqual({id:'tok_by_id',userId:'usr_1',email:'one@example.com',emailVerified:true});
  expect(await reader.byId!('tok_missing')).toBeNull();
  expect(await reader.byId!('')).toBeNull();
  await mintTestToken({id:'tok_expired_id',userId:'usr_1',query:testDb().query});
  await testDb().query("UPDATE tokens SET expires_at=now()-interval '1 second' WHERE id='tok_expired_id'");
  expect(await reader.byId!('tok_expired_id')).toBeNull();
  await testDb().query("UPDATE tokens SET deleted_at=now() WHERE id='tok_by_id'");
  expect(await reader.byId!('tok_by_id')).toBeNull();
  await oauth('tok_fenced_id');
  expect(await reader.byId!('tok_fenced_id')).toBeNull();
  const refresh=await member('tok_fenced_id');
  expect(await reader.byId!('tok_fenced_id')).toMatchObject({id:'tok_fenced_id',scope:'artifacts'});
  await store().revokeRefresh(refresh,'client');
  expect(await reader.byId!('tok_fenced_id')).toBeNull();
  await mintTestToken({id:'tok_policy_id',userId:'usr_1',query:testDb().query});
  expect(await createBearerReader({db,admitBearer:async()=>false}).byId!('tok_policy_id')).toBeNull();
 });

 it('applies the owning service admission policy after the read',async()=>{
  const token=await mintTestToken({id:'tok_policy',userId:'usr_1',query:testDb().query});
  const seen:string[]=[];
  expect(await createBearerReader({db,admitBearer:async t=>{seen.push(t.id);return false;}}).byToken(token)).toBeNull();
  expect(seen).toEqual(['tok_policy']);
 });

 it('qualifies tables by the configured schemas and admits only plain identifiers',async()=>{
  const statements:string[]=[];
  await createBearerReader({db:{query:async(sql)=>{statements.push(sql);return {rows:[]};}},authSchema:'identity',appSchema:'app'}).byToken('mx_'+'q'.repeat(40));
  // Only ever a SELECT: the proxy's role holds SELECT on the app's tokens and nothing else.
  expect(statements).toHaveLength(1);expect(statements[0]).toMatch(/^\s*SELECT /);
  expect(statements[0]).toMatch(/FROM app\.tokens t/);
  expect(statements[0]).toMatch(/identity\.credentials member/);
  expect(statements[0]).toMatch(/identity\."user" u/);
  expect(()=>createBearerReader({db,appSchema:'app; drop table tokens'})).toThrow(/schema/);
  expect(()=>createBearerReader({db,authSchema:'Auth'})).toThrow(/schema/);
 });
});
