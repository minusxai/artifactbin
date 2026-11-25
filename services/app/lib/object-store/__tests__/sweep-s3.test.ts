/**
 * THE OBJECT SWEEP on a REAL S3-compatible server: the shared contract (sweep-contract.ts), and what only S3 shows. The
 * store's prefix: the ledger holds the caller's key and the sweep deletes the prefixed object, never the same key at the
 * bucket root or under another prefix. A delete S3 refuses (no such bucket) or never answers keeps its row for the next
 * run. And on a real PostgreSQL with a short `idle_in_transaction_session_timeout`: deletes slower than that timeout
 * never outlive the row locks that guard them, so an orphan written again while they run keeps its object; and a
 * transaction the server ends while it idles fails, instead of its client's unheard error ending the process.
 *
 * CI's integration job (its `databases` part, .github/workflows/ci.yml) starts the server and exports TEST_S3_URL, and
 * pulls the Postgres image, so under CI a missing URL or image fails this file instead of skipping it, as
 * store-s3.test.ts does. Elsewhere it skips without them.
 */
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import pg from 'pg';
import {S3Client,HeadObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {SERVING_POOL,withPoolErrors} from '@artifactbin/utils';
import {dockerImage,startPostgres,type DisposablePostgres} from '@artifactbin/test-support/docker';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import { SCHEMA_STATEMENTS } from '@/lib/platform/testing';
import {PostgresDb} from '@/lib/platform/db';
import {createS3Store,objectKey,parseS3Url,recordObjectWrites,sweepObjects,type ObjectStore} from '..';
import {recordedWrites} from '../sweep';
import {absent,age,dueAt,sweepSuite,unique} from './sweep-contract';

const url=process.env.TEST_S3_URL;
if(!url&&process.env.CI)throw new Error('TEST_S3_URL is not set: CI\'s integration job starts an S3-compatible server and exports it, so these suites must run there, never skip');

useAppHarness();

describe.skipIf(!url)('the object sweep against a real S3-compatible server',()=>{
 const config=()=>parseS3Url(url!);
 sweepSuite('s3',async()=>createS3Store(config()));

 it('records the unprefixed key and deletes only the prefixed object, never the same key elsewhere in the bucket',async()=>{
  const cfg=config();expect(cfg.prefix).toBeTruthy(); // the fixture must exercise a prefix
  const raw=createS3Store(cfg),key=objectKey('dataset',unique());
  const client=new S3Client({region:cfg.region,endpoint:cfg.endpoint,forcePathStyle:cfg.forcePathStyle,credentials:{accessKeyId:cfg.accessKeyId,secretAccessKey:cfg.secretAccessKey}});
  const elsewhere=[key,`other-${cfg.prefix}/${key}`];
  for(const Key of elsewhere)await client.send(new PutObjectCommand({Bucket:cfg.bucket,Key,Body:'theirs'}));
  await recordedWrites(raw).put(key,'ours');
  expect((await (await getDb()).query<{key:string}>('SELECT key FROM object_writes')).rows).toEqual([{key}]);
  await age(key);
  expect(await sweepObjects(await getDb(),raw)).toEqual({deleted:[key],kept:0});
  await expect(client.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:`${cfg.prefix}/${key}`}))).rejects.toBeTruthy();
  for(const Key of elsewhere)await expect(client.send(new HeadObjectCommand({Bucket:cfg.bucket,Key}))).resolves.toBeTruthy();
 });

 it.each([
  ['refuses (the bucket does not exist)',()=>createS3Store({...config(),bucket:`missing-${Date.now()}`})],
  ['never answers (nothing listens)',()=>createS3Store({...config(),endpoint:'http://127.0.0.1:9'},{connectionTimeout:200,requestTimeout:200})],
 ])('keeps the row and object of a delete S3 %s, and deletes it on the next run',async(_,broken)=>{
  const raw=createS3Store(config()),key=objectKey('image',unique()),db=await getDb();
  await recordedWrites(raw).put(key,'bytes');await age(key);
  await expect(sweepObjects(db,broken())).rejects.toBeTruthy();
  expect((await raw.get(key)).toString()).toBe('bytes');expect(await dueAt(key)).toBeDefined();
  expect(await sweepObjects(db,raw)).toEqual({deleted:[key],kept:0});
  await absent(raw,key);
 },30_000);
});

describe.skipIf(!url||!dockerImage('postgres:17-alpine'))('the sweep\'s deletes on PostgreSQL, slower than its idle-in-transaction timeout',()=>{
 const IDLE_MS=1000,DELETE_MS=1500;
 let server:DisposablePostgres|undefined,db:PostgresDb|undefined;
 beforeAll(async()=>{
  server=await startPostgres();
  const pool=withPoolErrors(new pg.Pool({connectionString:server.url,...SERVING_POOL,idle_in_transaction_session_timeout:IDLE_MS}));
  for(const sql of SCHEMA_STATEMENTS)await pool.query(sql);
  db=new PostgresDb(pool);
 },120_000);
 afterAll(async()=>{await db?.close();server?.stop();});
 it('keeps an orphan written again while they run: no delete outlives the row locks that guard it',async()=>{
  const raw=createS3Store(parseS3Url(url!)),keys=[0,1,2].map(()=>objectKey('dataset',unique()));
  await recordObjectWrites(keys,db);
  for(const key of keys)await raw.put(key,'old');
  await db!.query("UPDATE object_writes SET due_at=now()-interval '1 second'");
  let started:()=>void=()=>{};const deleting=new Promise<void>(resolve=>{started=resolve;});
  const slow:Pick<ObjectStore,'delete'>={async delete(key){started();await new Promise(r=>setTimeout(r,DELETE_MS));await raw.delete(key);}};
  const sweeping=sweepObjects(db!,slow).then(()=>null,(error:unknown)=>error);
  // Past the idle timeout, while the deletes run, another process writes the last orphan's content again: it records
  // the key (a committed statement on its own connection) and then puts the object, as objectStore() does.
  await deleting;await new Promise(r=>setTimeout(r,IDLE_MS+200));
  const rewritten=keys[2]!;
  await recordObjectWrites([rewritten],db);await raw.put(rewritten,'new');
  await sweeping;
  expect((await raw.get(rewritten)).toString()).toBe('new');
  expect((await db!.query<{key:string}>('SELECT key FROM object_writes WHERE due_at>now()')).rows).toEqual([{key:rewritten}]);
 },60_000);
 it('fails a transaction whose session the server ended while it idled, and the process carries on (lib/platform PostgresDb)',async()=>{
  await expect(db!.transaction(async tx=>{await tx.query('SELECT 1');await new Promise(r=>setTimeout(r,IDLE_MS+500));await tx.query('SELECT 1');}))
   .rejects.toThrow(/idle-in-transaction timeout/);
  expect((await db!.query<{n:number}>('SELECT 1 AS n')).rows).toEqual([{n:1}]);
 },30_000);
});
