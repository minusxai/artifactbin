import assert from 'node:assert/strict';

/** Same observed SQL behavior, once local and once from a separately installed HTTP client. */
export async function checkSql(service) {
  const columns = [{name: 'a', type: 'number'}];
  const table = {columns, rows: [{a: 1}, {a: 2}, {a: 3}, {a: 4}]};
  const query = await service.run({tables: {t: table}, queries: [
    {name: 'q', sql: 'select a*2 as b from t order by b'},
    {name: 'q2', sql: 'select count(*) as n from q'},
  ], params: {}});
  assert.deepEqual(query.q.rows, [{b: 2}, {b: 4}, {b: 6}]);
  assert.equal(query.q.totalRows, 4); assert.equal(query.q.truncated, true);
  assert.deepEqual(query.q2.rows, [{n: 3}]);
  const bound = await service.run({tables: {t: table}, queries: [{name: 'q', sql: 'select a from t where a > $min'}], params: {min: 2}});
  assert.deepEqual(bound.q.rows, [{a: 3}, {a: 4}]);
  const denied = await service.run({tables: {t: table}, queries: [{name: 'q', sql: 'drop table t'}], params: {}});
  assert.ok(denied.q.error);
  const mutation = await service.mutate({table: {name: 'ref_t', columns, rows: [{a: 1}]}, sql: 'insert into ref_t values ($v)', params: {v: 5}});
  assert.deepEqual(mutation.rows, [{a: 1}, {a: 5}]);
  const dry = await service.dryRun({tables: {t: {columns}}, queries: [{name: 'good', sql: 'select a from t'}, {name: 'bad', sql: 'select missing from t'}], paramNames: []});
  assert.deepEqual(dry.errors.map(error => error.name), ['bad']);
  const dryMutation = await service.dryRunMutations({tables: {ref_t: {columns}}, mutations: [
    {name: 'good', target: 't', sql: 'insert into ref_t values ($v)'},
    {name: 'bad', target: 'missing', sql: 'delete from missing'},
  ], paramNames: ['v']});
  assert.deepEqual(dryMutation.errors.map(error => error.name), ['bad']);
  return ['dependency queries and caps', 'bound parameters', 'read-only policy', 'mutation', 'query dry run', 'mutation dry run'];
}
