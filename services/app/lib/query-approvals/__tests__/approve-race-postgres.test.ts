/**
 * TWO APPROVALS OF ONE QUERY AT ONCE, on a real PostgreSQL 17 (a disposable `postgres:17-alpine`) over independent
 * connections, which PGLite (one serialized connection) can never interleave: both see no live approval, the first
 * inserts and is held before it commits, the second's insert waits on the live index. The second answers the approval
 * the first made, never a failure. Runs in the `integration-databases` project; skipped without the image, except in CI,
 * which provides it (test-support/docker).
 */
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import pg from 'pg';
import * as platform from '@/lib/platform';
import {PostgresDb} from '@/lib/platform/db';
import {SCHEMA_STATEMENTS} from '@/lib/platform/testing';
import {identityViewStatements} from '@artifactbin/auth/identity-store/views';
import {dockerImage,startPostgres,type DisposablePostgres} from '@artifactbin/test-support/docker';
import {approvePageQuery,pageQueryApprovals} from '..';

const HTML_META={htmlLinks:[{kind:'default-connection',name:'wh',namespace:''}],htmlQueries:[{name:'totals',link:'wh',sql:'select region from wh.sales where region = :region',params:{region:{values:['EU']}}}]};
const ADA={userId:'ada',tokenId:null,email:null,documentEditor:false};
type Projection={__artifact_bin_event_projection__?:unknown};

describe.skipIf(!dockerImage('postgres:17-alpine'))('approving one query twice at once on PostgreSQL',()=>{
 let server:DisposablePostgres|undefined,pool:pg.Pool,db:PostgresDb,projection:unknown;
 beforeAll(async()=>{
  server=await startPostgres();
  pool=new pg.Pool({connectionString:server.url,max:6});
  for(const sql of SCHEMA_STATEMENTS)await pool.query(sql);
  // The identity module's rows these statements read (its views in a deployment), only the columns they touch.
  await pool.query(`CREATE TABLE users(id text PRIMARY KEY,email text,kind text,name text,username text,test_account boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true);
   CREATE TABLE groups(id text PRIMARY KEY,name text,deleted_at timestamptz,parent_id text);
   CREATE TABLE group_members(group_id text,user_id text,role text,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(group_id,user_id));
   INSERT INTO users(id,kind) VALUES('ada','account'); INSERT INTO groups(id,name) VALUES('team','Team'); INSERT INTO group_members(group_id,user_id,role) VALUES('team','ada','admin')`);
  await pool.query(identityViewStatements({auth:'public',app:'public',read:'public'},{sessions:false}).find(sql=>sql.includes('VIEW public.group_admins'))!);
  await pool.query("INSERT INTO artifacts(id,group_id,format,source,meta,visibility,ancestor_ids) VALUES('page','team','html','',$1,'private','{}')",[JSON.stringify(HTML_META)]);
  db=new PostgresDb(pool as never);vi.spyOn(platform,'getDb').mockResolvedValue(db);
  projection=(globalThis as unknown as Projection).__artifact_bin_event_projection__;
  (globalThis as unknown as Projection).__artifact_bin_event_projection__=async()=>{};
 },120_000);
 afterAll(async()=>{(globalThis as unknown as Projection).__artifact_bin_event_projection__=projection;vi.restoreAllMocks();await db?.close();server?.stop();});

 it('answers the second with the first one\'s approval',async()=>{
  const hash=(await pageQueryApprovals(ADA,'page')).queries[0]!.hash;
  // Hold every audit write: the first approval inserts, then waits here before it commits.
  const holder=await pool.connect();
  await holder.query('BEGIN');await holder.query('LOCK TABLE event_outbox IN EXCLUSIVE MODE');
  const waiting=async()=>Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND datname=current_database()")).rows[0].n);
  const first=approvePageQuery(ADA,'page',{query:'totals',hash});
  while(await waiting()<1)await new Promise(resolve=>setTimeout(resolve,10));
  const second=approvePageQuery(ADA,'page',{query:'totals',hash});
  while(await waiting()<2)await new Promise(resolve=>setTimeout(resolve,10));
  await holder.query('COMMIT');holder.release();
  const [a,b]=await Promise.allSettled([first,second]);
  expect([a.status,b.status]).toEqual(['fulfilled','fulfilled']);
  expect((b as PromiseFulfilledResult<{id:string}>).value.id).toBe((a as PromiseFulfilledResult<{id:string}>).value.id);
  expect((await pool.query('SELECT count(*)::int AS n FROM page_query_approvals WHERE ended_at IS NULL')).rows).toEqual([{n:1}]);
 },60_000);
});
