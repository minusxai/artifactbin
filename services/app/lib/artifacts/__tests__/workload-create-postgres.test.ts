/** Canonical workload creation and its immutable receipt race on independent real PostgreSQL connections. */
import {execFileSync,spawnSync} from 'node:child_process';
import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import pg from 'pg';
import * as platform from '@/lib/platform';
import {PostgresDb} from '@/lib/platform/db';
import {SCHEMA_STATEMENTS} from '@/lib/platform';
import {createWorkloadArtifact} from '../index';
const available=spawnSync('docker',['image','inspect','postgres:17-alpine'],{stdio:'ignore'}).status===0;
describe.skipIf(!available)('workload receipt on PostgreSQL',()=>{
 let container='',pool:pg.Pool,db:PostgresDb;
 beforeAll(async()=>{
  container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_PASSWORD=pw','-p','127.0.0.1::5432','postgres:17-alpine'],{encoding:'utf8'}).trim();
  const port=Number(execFileSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'}).trim().split('\n')[0].split(':').at(-1));
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'pw',max:5});
  for(let attempt=0;;attempt++){try{await pool.query('SELECT 1');break;}catch{if(attempt>60)throw Error('PostgreSQL unavailable');await new Promise(resolve=>setTimeout(resolve,100));}}
  for(const sql of SCHEMA_STATEMENTS)await pool.query(sql);
  await pool.query("CREATE TABLE groups(id text PRIMARY KEY,deleted_at timestamptz); INSERT INTO groups VALUES('group',NULL)");
  await pool.query("INSERT INTO artifacts(id,group_id,format,source,meta,visibility,ancestor_ids) VALUES('folder','group','folder','', '{}','private','{}')");
  db=new PostgresDb(pool);vi.spyOn(platform,'getDb').mockResolvedValue(db);
 },30000);
 afterAll(async()=>{vi.restoreAllMocks();await db?.close();if(container)execFileSync('docker',['rm','-f',container],{stdio:'ignore'});});
 it('atomically returns one original id across concurrent create/replay/conflict/deletion',async()=>{
  const scope={allowed:true as const,principal:{issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:'group',executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1},role:'editor' as const,readArtifactIds:[],rootFolderId:'folder',visibility:'private' as const,creationKey:'slot-action'};
  const input={format:'html' as const,source:'<!doctype html><html><head></head><body><p>Report</p></body></html>',title:'Report',meta:{}};
  const [first,second]=await Promise.all([createWorkloadArtifact(scope,input,'payload'),createWorkloadArtifact(scope,input,'payload')]);
  expect((await pool.query("SELECT response_until='infinity'::timestamptz AS durable FROM artifact_creation_operations")).rows).toEqual([{durable:true}]);
  expect(first.status).toBe(201);expect(second.body.id).toBe(first.body.id);
  expect((await pool.query("SELECT id FROM artifacts WHERE format='html'")).rows).toHaveLength(1);
  expect((await createWorkloadArtifact(scope,{...input,title:'Changed'},'changed')).status).toBe(409);
  await pool.query('DELETE FROM artifacts WHERE id=$1',[first.body.id]);
  expect(await createWorkloadArtifact(scope,input,'payload')).toMatchObject({status:410,body:{id:first.body.id}});
 });
});
