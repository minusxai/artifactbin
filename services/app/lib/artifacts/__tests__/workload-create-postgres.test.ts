/** Canonical workload creation and its immutable receipt race on independent real PostgreSQL connections. */
import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import pg from 'pg';
import * as platform from '@/lib/platform';
import {PostgresDb} from '@/lib/platform/db';
import {SCHEMA_STATEMENTS} from '@/lib/platform';
import {dockerImage,startPostgres,type DisposablePostgres} from '@artifactbin/test-support/docker';
import {createWorkloadArtifact,readWorkloadOutputPage} from '../index';
describe.skipIf(!dockerImage('postgres:17-alpine'))('workload receipt on PostgreSQL',()=>{
 let server:DisposablePostgres|undefined,pool:pg.Pool,db:PostgresDb;
 beforeAll(async()=>{
  // Ready when it answers over TCP, however long the container takes (it was a 6 s connect loop).
  server=await startPostgres();
  pool=new pg.Pool({connectionString:server.url,max:5});
  for(const sql of SCHEMA_STATEMENTS)await pool.query(sql);
  await pool.query("CREATE TABLE groups(id text PRIMARY KEY,deleted_at timestamptz); INSERT INTO groups VALUES('group',NULL)");
  await pool.query("INSERT INTO artifacts(id,group_id,format,source,meta,visibility,ancestor_ids) VALUES('folder','group','folder','', '{}','private','{}')");
  db=new PostgresDb(pool);vi.spyOn(platform,'getDb').mockResolvedValue(db);
 },120_000);
 afterAll(async()=>{vi.restoreAllMocks();await db?.close();server?.stop();});
 it('atomically returns one original id across concurrent create/replay/conflict/deletion',async()=>{
  const scope={allowed:true as const,principal:{issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:'group',executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1},role:'editor' as const,readArtifactIds:[],rootFolderId:'folder',visibility:'private' as const,creationKey:'slot-action',publication:{maxArtifacts:100,maxBytes:16*1024*1024}};
  const input={format:'html' as const,source:'<!doctype html><html><head></head><body><p>Report</p></body></html>',title:'Report',meta:{}};
  const [first,second]=await Promise.all([createWorkloadArtifact(scope,input,'payload'),createWorkloadArtifact(scope,input,'payload')]);
  expect((await pool.query("SELECT response_until='infinity'::timestamptz AS durable FROM artifact_creation_operations")).rows).toEqual([{durable:true}]);
  expect(first.status).toBe(201);expect(second.body.id).toBe(first.body.id);
  expect((await pool.query("SELECT id FROM artifacts WHERE format='html'")).rows).toHaveLength(1);
  expect((await pool.query('SELECT artifact_id FROM workload_publication_audit')).rows).toEqual([{artifact_id:first.body.id}]);
  expect((await pool.query('SELECT artifact_id FROM workload_publication_outputs')).rows).toEqual([{artifact_id:first.body.id}]);
  expect((await createWorkloadArtifact({...scope,creationKey:'next-slot',publication:{maxArtifacts:1,maxBytes:16*1024*1024}},input,'next')).status).toBe(403);
  expect((await createWorkloadArtifact(scope,{...input,title:'Changed'},'changed')).status).toBe(409);
  const page=await readWorkloadOutputPage(scope.principal,null);expect(page.items.map(row=>row.id)).toEqual([first.body.id]);
  expect((await readWorkloadOutputPage({...scope.principal,executionId:'sibling'},null)).items).toEqual([]);
  await pool.query('DELETE FROM artifacts WHERE id=$1',[first.body.id]);
  expect(await createWorkloadArtifact(scope,input,'payload')).toMatchObject({status:410,body:{id:first.body.id}});
 });
});
