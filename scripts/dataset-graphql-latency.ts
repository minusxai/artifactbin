/**
 * DATASET GRAPHQL LATENCY — a benchmark, never a test: no CI job runs it and nothing asserts a budget.
 *
 *   node --import tsx scripts/dataset-graphql-latency.ts [--rows 20000] [--runs 30] [--warmup 3] [--sql pool|thread] [--json <file>]
 *
 * Generated-API reads through the real route handler (`POST /api/artifacts/<id>/graphql`, the dataset's own
 * endpoint), in this process, on an in-memory PGLite and the server's SQL engine: its worker pool
 * (`@artifactbin/sql/local`, the default) or one engine on this thread (`--sql thread`, as the test suite runs it).
 * The callers are the owner and a viewer whose select rule filters half the rows and hides a column. Per caller and
 * query: the statements one warm request issues (lib/platform `measureQueries`), wall time p50 / p95 over `--runs`
 * sequential requests after `--warmup`, and the process's peak RSS sampled every 10 ms while they ran.
 *
 * The budget test pins the statements (services/app/lib/dataset-graphql/__tests__/dataset-graphql-budget.test.ts);
 * this script measures what they and the engine cost. Results: docs/resolver-latency.md, "Dataset GraphQL".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { suiteEnv } from './lib/suite-env.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function parse(argv: string[]) {
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const int = (name: string, fallback: number) => { const raw = value(name); const n = raw === undefined ? fallback : Number(raw); if (!Number.isSafeInteger(n) || n < 1) throw Error(`--${name} must be a positive integer`); return n; };
  const sql = value('sql') ?? 'pool';
  if (sql !== 'pool' && sql !== 'thread') throw Error('--sql is pool or thread');
  return { rows: int('rows', 20000), runs: int('runs', 30), warmup: int('warmup', 3), sql, json: value('json') };
}

/** Nearest-rank percentile; the sample is small, so no interpolation pretends to more precision. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
const fmt = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString());

const QUERIES: Record<string, string> = {
  'list (100 rows)': '{ staff(order_by: {score: desc}, limit: 100) { _id name team score } }',
  '2 roots (list + count)': '{ staff(order_by: {score: desc}, limit: 100) { _id name team score } staff_aggregate { aggregate { count } } }',
  'count + sum + nodes': '{ staff_aggregate(where: {score: {_gt: 10}}) { aggregate { count sum { score } } nodes { name } } }',
};

async function main() {
  const o = parse(process.argv.slice(2));
  // The suite's configuration, an in-memory database and a private object directory, before any app module reads them.
  Object.assign(process.env, suiteEnv(ROOT), { DATABASE_URL: 'pglite://memory', OBJECT_STORE__LOCAL_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-graphql-latency-')) });
  process.chdir(path.join(ROOT, 'services/app'));
  const { getDb, measureQueries, setServices, MAX_QUERY_ROWS, QUERY_TIMEOUT_MS } = await import('@/lib/platform');
  const { createUser, identityForUser, mintToken } = await import('@/lib/accounts');
  const { writeDatasetPolicy } = await import('@/lib/document-data');
  const { createArtifactFromBody } = await import('@/lib/publish');
  const { POST } = await import('@/app/api/artifacts/[id]/graphql/route');
  const caps = { maxRows: MAX_QUERY_ROWS, timeoutMs: QUERY_TIMEOUT_MS };
  const sql = o.sql === 'pool' ? (await import('@artifactbin/sql/local')).createSql(caps) : (await import('@artifactbin/sql/sqlite')).createSqliteSql(caps);
  setServices({ sql });

  const db = await getDb();
  async function person(name: string) {
    const email = `mxmx_test_${name}_${randomUUID()}@example.test`, userId = (await createUser({ email })).id;
    const token = await mintToken(name, userId, db);
    return { token: token.token, actor: identityForUser(userId, token.id, email), userId, email };
  }
  const owner = await person('bench_owner'), viewer = await person('bench_viewer');
  const rows = Array.from({ length: o.rows }, (_, i) => ({ name: `n${i}`, team: i % 2 ? 'blue' : 'red', score: i % 97, salary: i }));
  const created = await createArtifactFromBody({ dataset: rows, title: 'Staff', access: 'readwrite', visibility: 'unlisted' }, owner.actor as typeof owner.actor & { tokenId: string }, 'http://localhost:3000');
  if (created.status !== 201) throw Error(`dataset_create_${created.status}: ${await created.text()}`);
  const id = (await created.json() as { id: string }).id;
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [id, viewer.userId, viewer.email]);
  const policy = { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [
    { role: 'viewer', permission: { columns: ['name', 'team', 'score'], filter: { team: { _eq: 'red' } }, allow_aggregations: true } },
  ] }] };
  const saved = await writeDatasetPolicy(owner.actor, id, { policy, expectedPolicyRevision: 0 });
  if (saved.status !== 200) throw Error(`policy_${saved.status}: ${await saved.text()}`);

  const call = async (token: string, query: string) => {
    const response = await POST(new Request(`http://localhost:3000/api/artifacts/${id}/graphql`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) }), { params: Promise.resolve({ id }) });
    const body = await response.json() as { errors?: unknown[] };
    if (response.status !== 200 || body.errors) throw Error(`graphql_${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  };

  const results: Array<{ caller: string; query: string; statements: number; p50: number; p95: number; rssMiB: number }> = [];
  for (const [caller, who] of [['owner', owner], ['viewer', viewer]] as const) {
    for (const [name, query] of Object.entries(QUERIES)) {
      for (let i = 0; i < o.warmup; i++) await call(who.token, query);
      const { stats } = await measureQueries(() => call(who.token, query));
      let rss = process.memoryUsage().rss;
      const sampler = setInterval(() => { rss = Math.max(rss, process.memoryUsage().rss); }, 10);
      const times: number[] = [];
      for (let i = 0; i < o.runs; i++) { const t = performance.now(); await call(who.token, query); times.push(performance.now() - t); }
      clearInterval(sampler);
      results.push({ caller, query: name, statements: stats.count, p50: percentile(times, 50), p95: percentile(times, 95), rssMiB: Math.round(rss / 2 ** 20) });
    }
  }
  console.log(`Dataset GraphQL, ${o.rows} rows, SQL ${o.sql === 'pool' ? 'worker pool' : 'on this thread'}, ${o.runs} runs after ${o.warmup} warm-ups (ms)\n`);
  console.log('| caller | query | statements | p50 | p95 | peak RSS MiB |\n|---|---|---|---|---|---|');
  for (const r of results) console.log(`| ${r.caller} | ${r.query} | ${r.statements} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${r.rssMiB} |`);
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ rows: o.rows, sql: o.sql, runs: o.runs, warmup: o.warmup, results }, null, 2));
  if ('close' in sql && typeof sql.close === 'function') await sql.close();
  process.exit(0);
}

await main();
