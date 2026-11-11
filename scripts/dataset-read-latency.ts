/**
 * DATASET READ LATENCY — a benchmark, never a test: no CI job runs it and nothing asserts a budget.
 *
 *   node --import tsx scripts/dataset-read-latency.ts [--rows 5000] [--runs 50] [--warmup 5]
 *     [--concurrent 8] [--batches 3] [--workers <n>] [--modes pool,http] [--json <file>]
 *
 * The same statement read again and again from one stored dataset table of `--rows` rows, through the
 * real code unchanged: `executeCatalog` (lib/datasets, what every dataset door and the generated GraphQL
 * call) over the SQL engine's worker pool (`createSql`, the server's composition), in this process
 * (`pool`) or behind `serveSql` and `sqlClient` on loopback (`http`, the SQL service's shape). The rows
 * come from an in-memory object store answering the same bytes every time, as the store's read cache
 * does, so the time is the app's and the engine's, never the bucket's.
 *
 * Each mode reads as the owner (no role view) and as a viewer whose role view keeps a third of the
 * rows. Cold is the first read of a fresh pool; warm is the same read repeated one at a time;
 * concurrent is `--concurrent` reads at once. RSS is this process's, threads included, after the
 * mode ran. Results are not kept in the repository: record a run with `--json`.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { SqlService } from '@artifactbin/contracts';
import { serveSql, sqlClient } from '@artifactbin/sql';
import { createSql } from '@artifactbin/sql/local';
import { executeCatalog, type CatalogRowView, type DatasetCatalog } from '@/lib/datasets';

const ROOT = path.resolve(import.meta.dirname, '..');
type Series = Record<string, number[]>;

function parse(argv: string[]) {
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const int = (name: string, fallback: number) => { const raw = value(name); const n = raw === undefined ? fallback : Number(raw); if (!Number.isSafeInteger(n) || n < 1) throw Error(`--${name} must be a positive integer`); return n; };
  return {
    rows: int('rows', 5000), runs: int('runs', 50), warmup: int('warmup', 5), concurrent: int('concurrent', 8), batches: int('batches', 3),
    workers: value('workers') === undefined ? undefined : int('workers', 1),
    modes: (value('modes') ?? 'pool,http').split(',').filter(Boolean), json: value('json'),
  };
}

/** Nearest-rank percentile. */
function percentile(values: readonly number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
const fmt = (n: number) => Number.isFinite(n) ? (n < 10 ? n.toFixed(1) : Math.round(n).toString()) : '–';
const push = (series: Series, name: string, value: number) => { (series[name] ??= []).push(value); };

const REGIONS = ['east', 'west', 'north'];
function dataset(rows: number) {
  const data = Array.from({ length: rows }, (_, i) => ({ id: i + 1, region: REGIONS[i % 3]!, amount: (i * 37) % 1000, paid: i % 2 === 0, day: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}` }));
  const bytes = Buffer.from(JSON.stringify(data));
  const catalog: DatasetCatalog = {
    kind: 'stored', defaultSchema: 'public', refreshSeconds: 0,
    tables: [{ schema: 'public', name: 'rows', objectKey: `bench-${rows}`, columns: [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'paid', type: 'boolean' }, { name: 'day', type: 'date' }] }],
  };
  return { catalog, objects: { get: async (_key: string) => bytes } };
}

/** A role view keeping one region: what a v3 select rule with a filter does to the rows. */
const viewer: CatalogRowView = { identity: JSON.stringify(['viewer', 1, { 'x-hasura-role': 'viewer' }]), catalog: (c) => c, rows: (_t, rows) => rows.filter((r) => r.region === 'east') };

const READS = [
  { name: 'list', sql: 'SELECT id, region, amount, paid, day FROM public.rows WHERE amount > 100 ORDER BY amount DESC, id', limit: 100 },
  { name: 'aggregate', sql: 'SELECT region, count(*) AS n, sum(amount) AS total FROM public.rows GROUP BY region', limit: 100 },
];

async function mode(name: string, opts: ReturnType<typeof parse>) {
  const pool = createSql({ maxRows: 10_000, timeoutMs: 5_000 }, opts.workers ? { workers: opts.workers } : {});
  const server = name === 'http' ? serveSql(pool) : null;
  const svc: SqlService = server ? sqlClient(server.listen(0).url, { deadlineMs: 20_000 }) : pool;
  const { catalog, objects } = dataset(opts.rows);
  const cold: Record<string, number> = {}, warm: Series = {}, concurrent: Series = {};
  try {
    for (const [who, view] of [['owner', null], ['viewer', viewer]] as const) for (const read of READS) {
      const label = `${who} ${read.name}`;
      const once = async () => {
        const t0 = performance.now();
        const result = await executeCatalog(catalog, read.sql, {}, { view, objects, limit: read.limit, execute: svc.run });
        if (!result.rows.length) throw Error(`${label}: no rows`);
        return performance.now() - t0;
      };
      cold[label] = await once();
      for (let i = 0; i < opts.warmup; i++) await once();
      for (let i = 0; i < opts.runs; i++) push(warm, label, await once());
      for (let b = 0; b < opts.batches; b++) for (const ms of await Promise.all(Array.from({ length: opts.concurrent }, once))) push(concurrent, label, ms);
    }
    return { mode: name, cold, warm, concurrent, rssMb: process.memoryUsage().rss / 2 ** 20 };
  } finally {
    await server?.close();
    await pool.close();
  }
}

const opts = parse(process.argv.slice(2));
const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
console.log(`# Dataset read latency — ${opts.rows} rows, ${opts.runs} warm runs, ${opts.batches} × ${opts.concurrent} concurrent, revision ${revision}, node ${process.version}\n`);
const results = [];
for (const name of opts.modes) {
  const r = await mode(name, opts);
  results.push(r);
  console.log(`## ${name} (RSS after: ${Math.round(r.rssMb)} MB)\n\n| read (ms) | cold | warm p50 | warm p95 | concurrent p50 | concurrent p95 |\n|---|---|---|---|---|---|`);
  for (const label of Object.keys(r.cold)) console.log(`| ${label} | ${fmt(r.cold[label]!)} | ${fmt(percentile(r.warm[label]!, 50))} | ${fmt(percentile(r.warm[label]!, 95))} | ${fmt(percentile(r.concurrent[label]!, 50))} | ${fmt(percentile(r.concurrent[label]!, 95))} |`);
  console.log('');
}
if (opts.json) fs.writeFileSync(opts.json, JSON.stringify({ revision, options: opts, results }, null, 2));
