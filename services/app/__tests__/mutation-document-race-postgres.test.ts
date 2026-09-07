/** Exercise the actual mutation route and commit statement against concurrent
 * PostgreSQL transactions, not just the serialized embedded adapter. */
import {execFileSync, spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {effectiveRole,getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {claimToken,createUser} from '@/lib/users';
import {mintToken} from '@/lib/tokens';
import {request, useAppHarness} from './harness';
import {setServices} from '@/lib/services';
import {createSql} from '@artifactbin/sql/local';
import {createEvents} from '@artifactbin/events/local';
import {getDb} from '@/lib/db';

const state = vi.hoisted(() => {vi.resetModules(); return {url: ''};});
vi.mock('@/lib/config', async original => ({...await original<object>(), IS_TEST: false, get DATABASE_URL() {
  if (!state.url) throw new Error('Disposable Postgres must be ready before the application database opens');
  return state.url;
}}));
const available = spawnSync('docker', ['image', 'inspect', 'postgres:17-alpine'], {stdio: 'ignore'}).status === 0;
describe.skipIf(!available)('stored-document mutation guard on real PostgreSQL', () => {
  let container = '', connection: pg.Client;
  beforeAll(async () => {
    // The standard setup already imported the embedded adapter. Reload the
    // composition and inject its real services for this disposable PG test.
    setServices({sql: createSql({maxRows: 10000, timeoutMs: 5000}), events: createEvents({db: {query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await getDb()).query<T>(sql, params)}, schema: 'events'})});
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=mutation-race-test', '-p', '127.0.0.1::5432', 'postgres:17-alpine'], {encoding: 'utf8'}).trim();
    const port = Number(execFileSync('docker', ['port', container, '5432/tcp'], {encoding: 'utf8'}).trim().split(':').at(-1));
    state.url = `postgres://postgres:mutation-race-test@127.0.0.1:${port}/postgres`;
    for (let attempt = 0; attempt < 100; attempt++) {
      connection = new pg.Client({connectionString: state.url});
      try {await connection.connect(); return;} catch (error) {
        await connection.end(); if (attempt === 99) throw error; await delay(100);
      }
    }
  });
  useAppHarness({afterClose: async () => {
    // The harness closes the app pool before stopping its dependency.
    await connection?.end();
    if (container) execFileSync('docker', ['rm', '-f', container], {stdio: 'ignore'});
  }});
  it('waits for a concurrent document edit and rejects the stale mutation without changing dataset rows', async () => {
    const token = await mintToken('race');
    const publish = async (body: object) => {
      const response = await create(request('/api/artifacts', {method: 'POST', token: token.token, json: body}));
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()).id as string;
    };
    const dataset = await publish({dataset: [{n: 1}], access: 'readwrite'});
    expect((await getDb()).raw().kind).toBe('pg');
    const document = await publish({markup: `<Helmet><Mutation name="add">{\`insert into ref_${dataset} values (2)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
    await connection.query('BEGIN');
    await connection.query('UPDATE artifacts SET edit_id=$1 WHERE id=$2', ['changed-in-other-transaction', document]);
    let finished = false;
    const pending = mutate(request(`/a/${document}/mutate`, {method: 'POST', token: token.token, json: {mutation: 'add'}}), {params: Promise.resolve({id: document})}).finally(() => {finished = true;});
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !finished; attempt++) {
        await connection.query('SELECT pg_stat_clear_snapshot()');
        const active = await connection.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%approved_document%'");
        if (active.rows.length) {waiting = true; break;}
        await delay(25);
      }
      expect(waiting, 'the production commit must lock/check the stored document, not read a stale MVCC snapshot').toBe(true);
      await connection.query('COMMIT');
      const response = await pending;
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe('document_changed');
      expect((await getArtifactById(dataset))?.version).toBe(1);
    } finally {
      await connection.query('ROLLBACK');
      await pending;
    }
  });
  it.each(['document','dataset'] as const)('checks the new %s ACL after waiting for a concurrent revocation',async kind=>{
    const owner=await mintToken('owner'),friend=await mintToken('friend');
    const ownerUser=await createUser({email:'mxmx_test_race_owner@example.com'});
    const friendUser=await createUser({email:'mxmx_test_race_friend@example.com'});
    await claimToken(ownerUser.id,owner.token);await claimToken(friendUser.id,friend.token);
    const publish=async(body:object)=>{
      const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));
      expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;
    };
    const dataset=await publish({dataset:[{n:1}],access:'readwrite'});
    const document=await publish({markup:`<Helmet><Mutation name="add">{\`insert into ref_${dataset} values (2)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
    for(const id of [dataset,document]){
      await updateSharingFor({tokenId:owner.id,userId:ownerUser.id},id,{shares:[{email:friendUser.email,role:id===dataset?'editor':'viewer'}]});
      await effectiveRole((await getArtifactById(id))!,{tokenId:friend.id,userId:friendUser.id});
    }
    const target=kind==='document'?document:dataset;
    await connection.query('BEGIN');
    await connection.query('SELECT 1 FROM artifacts WHERE id=$1 FOR UPDATE',[target]);
    await connection.query('DELETE FROM artifact_shares WHERE artifact_id=$1',[target]);
    let finished=false;
    const pending=mutate(request(`/a/${document}/mutate`,{method:'POST',token:friend.token,json:{mutation:'add'}}),{params:Promise.resolve({id:document})}).finally(()=>{finished=true;});
    try{
      let waiting=false;
      for(let attempt=0;attempt<100&&!finished;attempt++){
        await connection.query('SELECT pg_stat_clear_snapshot()');
        const active=await connection.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%approved_document%'");
        if(active.rows.length){waiting=true;break;}await delay(25);
      }
      expect(waiting,'the commit must wait for the ACL transaction').toBe(true);
      await connection.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect((await getArtifactById(dataset))?.version).toBe(1);
    }finally{await connection.query('ROLLBACK');await pending;}
  });
});
