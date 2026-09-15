import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {checkSql} from './conformance.mjs';
registerHooks({resolve(specifier, context, next) {
  if (/@duckdb|playwright|sharp|\.node$/.test(specifier)) throw Error('Engine imported by production client: ' + specifier);
  return next(specifier, context);
}});
const {sqlClient} = await import('@artifactbin/proof-client');
const url = process.argv[2];
const checks = await checkSql(sqlClient(url, {serviceSecret: 'probe-only-not-a-user-token'}));
const unauthorized = await sqlClient(url).run({tables: {}, queries: [{name: 'q', sql: 'select 1'}], params: {}});
assert.ok(unauthorized.q.error);
console.log(JSON.stringify({checks, unauthorized: 'rejected', nativeImports: 'none'}));
