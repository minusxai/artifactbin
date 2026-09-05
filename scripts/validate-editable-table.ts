/** Design probes, not an implementation of Column. Run: npx tsx scripts/validate-editable-table.ts */
import assert from 'node:assert/strict';
import { DuckDBInstance, STRUCT, DOUBLE, VARCHAR } from '@duckdb/node-api';
import { createSql } from '@artifactbin/sql/local';
import { serveSql, sqlClient } from '@artifactbin/sql';

const results: Array<{ probe: string; evidence: unknown }> = [];
const record = (probe: string, evidence: unknown) => results.push({ probe, evidence });
const instance = await DuckDBInstance.create(':memory:');
const conn = await instance.connect();
try {
  await conn.run("create table tasks(id double, status varchar, hours double, due date); insert into tasks values (1, 'backlog', 2, '2026-09-05')");
  const prepared = await conn.prepare('update tasks set status = $_value where id = $_row.id and status is not distinct from $_row.status');
  const rowType = STRUCT({ id: DOUBLE, status: VARCHAR });
  const edit = async (status: string, original: string | null) => {
    prepared.bindStruct(prepared.parameterIndex('_row'), { id: 1, status: original }, rowType);
    prepared.bindVarchar(prepared.parameterIndex('_value'), status);
    return (await prepared.run()).rowsChanged;
  };
  assert.equal(await edit('active', 'backlog'), 1);
  assert.equal(await edit('done', 'backlog'), 0);
  record('typed struct + stale-cell predicate', 'first edit affected 1; stale edit affected 0');
  await conn.run('update tasks set status = null');
  assert.equal(await edit('active', null), 1);
  record('null-safe original value', 'NULL original matched with IS NOT DISTINCT FROM');
  const date = await conn.prepare('select due = $_row.due as matches from tasks');
  date.bindStruct(date.parameterIndex('_row'), { due: '2026-09-05' }, STRUCT({ due: VARCHAR }));
  assert.equal((await date.runAndReadAll()).getRowObjects()[0].matches, true);
  record('date text inside struct', 'VARCHAR field compares to DATE');
  const empty = await conn.prepare('select $_row.id as id, $_row.status as status');
  empty.bindStruct(empty.parameterIndex('_row'), { id: null, status: null }, rowType);
  assert.deepEqual((await empty.runAndReadAll()).getRowObjects(), [{ id: null, status: null }]);
  const typo = await conn.prepare('select $_row.staus');
  typo.bindStruct(typo.parameterIndex('_row'), { id: null, status: null }, rowType);
  await assert.rejects(() => typo.run(), /staus|key/i);
  record('typed null fields and typo', 'valid fields resolve; staus rejected');
} finally { conn.closeSync(); instance.closeSync(); }

const local = createSql({ maxRows: 100, timeoutMs: 2000 });
const server = serveSql(local);
const remote = sqlClient(server.listen(0).url, { deadlineMs: 5000 });
const columns = [{ name: 'id', type: 'number' as const }, { name: 'status', type: 'string' as const }, { name: 'hours', type: 'number' as const }, { name: 'tags', type: 'string' as const }];
const initial = [{ id: 1, status: 'backlog', hours: 2, tags: '' }];
try {
  for (const [transport, svc] of [['local', local], ['HTTP', remote]] as const) {
    const mutate = async (rows: typeof initial, sql: string, params: Record<string, string | number | null>) => {
      const out = await svc.mutate({ table: { name: 'ref_tasks', rows, columns }, sql, params });
      assert.ok(!('error' in out), JSON.stringify(out));
      return out as unknown as { rows: typeof initial; affected: number };
    };
    const first = await mutate(initial, 'update ref_tasks set status=$next where id=$id', { next: 'active', id: 1 });
    const overwrite = await mutate(first.rows, 'update ref_tasks set status=$next where id=$id', { next: 'done', id: 1 });
    assert.equal(overwrite.rows[0].status, 'done');
    const stale = await mutate(first.rows, 'update ref_tasks set status=$next where id=$id and status is not distinct from $old', { next: 'done', id: 1, old: 'backlog' });
    assert.equal(stale.affected, 0);
    const different = await mutate(first.rows, 'update ref_tasks set hours=$next where id=$id and hours is not distinct from $old', { next: 3, id: 1, old: 2 });
    assert.equal(different.rows[0].status, 'active');
    assert.equal(different.rows[0].hours, 3);
    const duplicate = await mutate([...initial, ...initial], 'update ref_tasks set status=$next where id=$id', { next: 'active', id: 1 });
    assert.equal(duplicate.affected, 2);
    const deleted = await mutate([], 'update ref_tasks set status=$next where id=$id', { next: 'active', id: 1 });
    assert.equal(deleted.affected, 0);
    const tags = ['design,ux', 'quote"tag', '日本語'];
    assert.notDeepEqual(tags.join(',').split(','), tags);
    const encoded = JSON.stringify(tags);
    const saved = await mutate(initial, 'update ref_tasks set tags=$tags where id=1', { tags: encoded });
    assert.deepEqual(JSON.parse(saved.rows[0].tags), tags);
    const selfDependency = await mutate(initial, 'update ref_tasks set tags=$deps where id=$id and not list_contains(cast($deps as varchar[]), cast(cast(id as bigint) as varchar))', { deps: '["1"]', id: 1 });
    assert.equal(selfDependency.affected, 0);
    const query = await svc.run({ tables: { t: { rows: saved.rows, columns } }, queries: [{ name: 'tags', sql: 'select unnest(cast(tags as varchar[])) as tag from t' }], params: {} });
    assert.ok(!('error' in query.tags), JSON.stringify(query));
    if (!('error' in query.tags)) assert.deepEqual(query.tags.rows.map(r => r.tag), tags);
    const struct = await svc.mutate({ table: { name: 'ref_tasks', rows: initial, columns }, sql: 'update ref_tasks set status=$_value where id=$_row.id', params: { _value: 'active', _row: { id: 1 } } as never });
    assert.ok('error' in struct);
    record(transport, { unconditional: 'last write wins', guardedStale: stale.affected, differentCells: different.rows[0], duplicateKeyAffected: duplicate.affected, deletedAffected: deleted.affected, selfDependencyAffected: selfDependency.affected, jsonTags: tags, currentStructTransportError: 'error' in struct ? struct.error : null });
  }
} finally { await server.close(); }
console.log(JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
