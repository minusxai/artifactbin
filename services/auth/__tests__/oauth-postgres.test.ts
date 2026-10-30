/** Optional selected database regression. This test owns AUTH_TEST_DATABASE_URL;
 * use a disposable PostgreSQL database with CREATEROLE, never a deployment DB. */
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {randomBytes} from 'node:crypto';
import type {Queryable} from '@artifactbin/contracts';
import {createTokenReader,hashToken} from '@artifactbin/utils';
import {createOAuthStore} from '../src/identity/oauth';
import {ensureAuthSchema} from '../src/schema';
import {createAuthHost} from '../src/parts';

const database=process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!database)('READ COMMITTED auth with separate connections and SELECT-only app role',()=>{
 const suffix=randomBytes(6).toString('hex'),authSchema=`auth_${suffix}`,appSchema=`app_${suffix}`,role=`reader_${suffix}`;
 let owner:Pool,auth:Pool;
 const queryable=(pool:Pool|PoolClient):Queryable=>({query:async<T>(sql:string,params:unknown[]=[])=>({rows:(await pool.query(sql,params)).rows as T[]})});
 const gate=()=>{let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};};
 beforeAll(async()=>{
  owner=new Pool({connectionString:database});
  await ensureAuthSchema(queryable(owner),authSchema);
  await owner.query(`CREATE SCHEMA ${appSchema}; CREATE TABLE ${appSchema}.tokens(id text primary key, name text, token_hash text, user_id text,audience text,scope text,expires_at timestamptz,deleted_at timestamptz); CREATE ROLE ${role}; GRANT USAGE ON SCHEMA ${appSchema},${authSchema} TO ${role}; GRANT SELECT ON ${appSchema}.tokens TO ${role}; GRANT ALL ON ALL TABLES IN SCHEMA ${authSchema} TO ${role}`);
  auth=new Pool({connectionString:database,options:`-c role=${role}`});
 });
 afterAll(async()=>{await auth?.end();if(owner){await owner.query(`DROP SCHEMA IF EXISTS ${appSchema} CASCADE; DROP SCHEMA IF EXISTS ${authSchema} CASCADE; DROP ROLE IF EXISTS ${role}`);await owner.end();}});
 const mint=async()=>{
  const id=`tok_${randomBytes(8).toString('hex')}`,token=`mx_${randomBytes(24).toString('hex')}`;
  await owner.query(`INSERT INTO ${appSchema}.tokens(id,name,token_hash,user_id,audience,scope) VALUES($1,'oauth',$2,'user','http://test/api','artifacts')`,[id,hashToken(token)]);return {id,token};
 };
 const store=()=>createOAuthStore(queryable(auth),authSchema,appSchema);
 const issue=async()=>{const access=await mint(),refresh=await store().issueRefresh({clientId:'client',userId:'user',resource:'http://test/api',scope:'artifacts',accessTokenId:access.id});return {access,refresh};};
 const host=()=>createAuthHost({identityDb:queryable(auth),appSchema,env:{AUTH__SCHEMA:authSchema,APP__PUBLIC_BASE_URL:'http://test'},sessions:{resolve:async()=>null},cookieSecret:'test',tokens:createTokenReader({db:queryable(auth),schema:appSchema}),upstream:async(_r,actor)=>Response.json({credential:actor.credential})});
 const admitted=async(token:string)=>(await(await host().request('http://test/api',{headers:{authorization:`Bearer ${token}`}})).json()).credential;
 it('revoke waits on rotation but its old statement snapshot cannot leave either bearer usable',async()=>{
  const first=await issue(),client=await owner.connect(),ready=gate(),resume=gate();
  let successor!:Awaited<ReturnType<typeof mint>>;
  try{
   await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
   const rotating=createOAuthStore({query:async<T>(sql:string,params?:unknown[])=>{
    const result=await queryable(client).query<T>(sql,params);
    if(sql.includes('SELECT credential_hash FROM inserted')){ready.release();await resume.promise;}
    return result;
   }},authSchema,appSchema).rotateAndMint(first.refresh,'client',['http://test/api'],async()=>successor=await mint());
   await ready.promise;
   let pid=0;const revokeClient=await auth.connect();
   try{
    pid=Number((await revokeClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const revoking=createOAuthStore(queryable(revokeClient),authSchema,appSchema).revokeRefresh(first.refresh,'client');
    // Wait on database evidence, not a timing guess: revocation has acquired its
    // statement snapshot and is waiting for the finalizer's family-row lock.
    for(let attempt=0;;attempt++){
     const waiting=(await owner.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type;
     if(waiting==='Lock')break;
     if(attempt>1000)throw Error('revoke did not reach lock');
     await new Promise(r=>setTimeout(r,2));
    }
    await client.query('COMMIT');resume.release();await rotating;await revoking;
   }finally{revokeClient.release();}
   const ids=(await owner.query(`SELECT payload->>'access_token_id' AS id FROM ${authSchema}.credentials WHERE group_id=(SELECT group_id FROM ${authSchema}.credentials WHERE kind='refresh_token' AND payload->>'access_token_id'=$1) AND kind='refresh_token'`,[first.access.id])).rows;
   expect(ids).toHaveLength(2);
   expect(await admitted(first.access.token)).toBe('none');expect(await admitted(successor.token)).toBe('none');
   for(const {id} of ids)expect(await store().accessLive(id)).toBe(false);
  }finally{resume.release();await client.query('ROLLBACK');client.release();}
 });
 it('two overlapping refreshes revoke replay family and direct deletion fences a paused mint',async()=>{
  const first=await issue(),ready=gate();let count=0;const minted:{id:string;token:string}[]=[];
  const mintTogether=async()=>{const token=await mint();minted.push(token);if(++count===2)ready.release();await ready.promise;return token;};
  const results=await Promise.all([store().rotateAndMint(first.refresh,'client',['http://test/api'],mintTogether),store().rotateAndMint(first.refresh,'client',['http://test/api'],mintTogether)]);
  expect(results.filter(Boolean).length).toBeLessThanOrEqual(1);
  for(const token of [first.access,...minted])expect(await admitted(token.token)).toBe('none');
  const second=await issue(),entered=gate(),resume=gate();let candidate!:Awaited<ReturnType<typeof mint>>;
  const pending=store().rotateAndMint(second.refresh,'client',['http://test/api'],async()=>{candidate=await mint();entered.release();await resume.promise;return candidate;});
  await entered.promise;await owner.query(`UPDATE ${appSchema}.tokens SET deleted_at=now() WHERE id=$1`,[second.access.id]);resume.release();
  expect(await pending).toBeNull();expect(await admitted(candidate.token)).toBe('none');
 });
 it('observes legacy membership added after backfill without app mutation privileges',async()=>{
  const first=await issue(),candidate=await mint();
  await ensureAuthSchema(queryable(owner),authSchema);
  await owner.query(`INSERT INTO ${authSchema}.credentials(kind,credential_hash,group_id,payload,expires_at) SELECT 'refresh_token',$1,group_id,jsonb_build_object('client_id','client','access_token_id',$2::text),expires_at FROM ${authSchema}.credentials WHERE kind='refresh_token' AND payload->>'access_token_id'=$3`,[randomBytes(16).toString('hex'),candidate.id,first.access.id]);
  expect(await admitted(candidate.token)).toBe('bearer');
  await store().revokeRefresh(first.refresh,'client');
  expect(await admitted(first.access.token)).toBe('none');expect(await admitted(candidate.token)).toBe('none');
  await expect(auth.query(`UPDATE ${appSchema}.tokens SET deleted_at=now()`)).rejects.toMatchObject({code:'42501'});
 });
});
