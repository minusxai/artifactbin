/**
 * RESOLVER CALL LATENCY — a benchmark, never a test: no CI job runs it and nothing asserts a budget.
 *
 *   node --import tsx scripts/resolver-latency.ts [--modes micro,runner,http,docker,app] [--runs 50]
 *     [--warmup 5] [--concurrent 8] [--batches 3] [--prestart <n>] [--image afbin-worker] [--base <dev app origin>] [--json <file>]
 *
 * One trivial resolver field (`ping: () => 'pong'`) is timed through the real code paths, unchanged:
 *
 * - `micro`  — the stages a receipt cannot split: `bundleSource` (cold = esbuild's service start), worker
 *              spawn → `ready` (with and without `--no-node-snapshot`), and `run` → `result` inside the
 *              worker (isolate + evaluate bundle + call), then SIGKILL → exit.
 * - `runner` — `createBackendInvoker` against an in-process `createRunner` (node child per run), the
 *              local composition's runner. Each call is split from its receipt and the completion wait:
 *              admit (start(): lookups + bundleSource + insert), queue (admittedAt → startedAt),
 *              execute (startedAt → finishedAt: claim a pre-started worker or spawn one, isolate, call,
 *              kill, exit), observe (finishedAt → completed getRun: persist + the completion wait's reply).
 *              `--prestart <n>` sets the runner's pre-started workers (default: the runner's own; 0 = none).
 * - `http`   — the same runner behind `runnerHttp` and the signed `runnerClient` on loopback: the
 *              production shape (the app reaches its runner over HTTP; each getRun is a request).
 * - `docker` — the runner with `dockerImage` (a container per run). Reference only: the production
 *              resolver runner does not set it. Needs `--image` (build: services/runner/Dockerfile).
 * - `app`    — end to end through the running dev app's page GraphQL (`npm run dev`, `.env` origin):
 *              logs in through the dev outbox, publishes a page with the resolver, then times
 *              `{ bench { ping } }` against a resolver-free `{ __typename }` baseline.
 *
 * Every runner mode runs in a fresh child process, so its first call is a real cold start (no esbuild
 * service, no JIT). The resolver is compiled once in this process, as publishing does, and handed over.
 * Results: docs/resolver-latency.md.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { HtmlJson, RunnerService, RunReceipt, RunStart } from '@artifactbin/contracts';

const gitOut = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
const ROOT = path.resolve(import.meta.dirname, '..');
const WORKER = path.join(ROOT, 'services/runner/src/runner-worker.mjs');
const SOURCE = 'export const typeDefs = "type Query { ping: String! }";\nexport default { ping: () => "pong" };\n';
const QUERY = '{ bench { ping } }';
const BASELINE = '{ __typename }';

type Options = { modes: string[]; runs: number; warmup: number; concurrent: number; batches: number; prestart?: number; image?: string; base?: string; json?: string };
type Series = Record<string, number[]>;
interface ModeResult { mode: string; note: string; cold: Record<string, number>; warm: Series; concurrent: Series }

function parse(argv: string[]): Options & { child?: string; compiled?: string } {
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const int = (name: string, fallback: number) => { const raw = value(name); const n = raw === undefined ? fallback : Number(raw); if (!Number.isSafeInteger(n) || n < 1) throw Error(`--${name} must be a positive integer`); return n; };
  return {
    modes: (value('modes') ?? 'micro,runner,http,app').split(',').filter(Boolean),
    runs: int('runs', 50), warmup: int('warmup', 5), concurrent: int('concurrent', 8), batches: int('batches', 3),
    prestart: value('prestart') === undefined ? undefined : (() => { const n = Number(value('prestart')); if (!Number.isSafeInteger(n) || n < 0) throw Error('--prestart must be a non-negative integer'); return n; })(),
    image: value('image'), base: value('base'), json: value('json'), child: value('child'), compiled: value('compiled'),
  };
}

// ---------- statistics ----------

/** Nearest-rank percentile; the sample is small, so no interpolation pretends to more precision. */
function percentile(values: readonly number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
const fmt = (n: number) => Number.isFinite(n) ? (n < 10 ? n.toFixed(1) : Math.round(n).toString()) : '–';
function table(title: string, series: Series): string {
  const rows = Object.entries(series).filter(([, v]) => v.length).map(([name, v]) =>
    `| ${name} | ${v.length} | ${fmt(percentile(v, 50))} | ${fmt(percentile(v, 95))} | ${fmt(Math.min(...v))} | ${fmt(Math.max(...v))} |`);
  return rows.length ? `${title}\n\n| stage (ms) | n | p50 | p95 | min | max |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n` : '';
}
const push = (series: Series, name: string, value: number) => { (series[name] ??= []).push(value); };

// ---------- micro: the stages inside one run ----------

interface WorkerTiming { spawnToReady: number; runToResult: number; workerWall: number; killToExit: number }
/** One worker exactly as local.ts drives it: spawn, `ready`, one `run`, then SIGKILL. */
async function workerOnce(bundle: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<WorkerTiming> {
  const t0 = performance.now();
  const child = spawn(args[0]!, args.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env });
  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => { const { value, done } = await lines.next(); if (done) throw Error('worker_exit'); return JSON.parse(value) as { type: string; wallMs?: number; error?: string }; };
  if ((await next()).type !== 'ready') throw Error('worker_not_ready');
  const ready = performance.now();
  child.stdin.write(JSON.stringify({ type: 'run', bundle, input: { kind: 'invoke', field: 'ping', args: {}, principal: { tenant: 'bench-page', subject: null, role: 'anonymous' as const } }, env: {}, memoryMiB: 64, cpuMs: 200 }) + '\n');
  const result = await next();
  if (result.type !== 'result') throw Error(`worker_${result.type}: ${result.error ?? ''}`);
  const done = performance.now();
  const exited = once(child, 'close');
  child.kill('SIGKILL');
  await exited;
  return { spawnToReady: ready - t0, runToResult: done - ready, workerWall: result.wallMs ?? NaN, killToExit: performance.now() - done };
}
const dockerArgs = (image: string, name: string) => ['create', '--rm', '--name', name, '--label', 'artifactbin.runner=true', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--memory', '192m', '--cpus', '1', '--pids-limit', '32', image];
async function exec(command: string, args: string[], tolerate = false): Promise<void> {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let error = ''; child.stderr.on('data', (b: Buffer) => { error += b.toString(); });
  const [code] = await once(child, 'close') as [number];
  if (code !== 0 && !tolerate) throw Error(`${command} ${args[0]}: ${error.trim()}`);
}

async function micro(compiled: string, o: Options): Promise<ModeResult> {
  const { bundleSource } = await import('../services/runner/src/compiler');
  const cold: Record<string, number> = {}, warm: Series = {};
  let t = performance.now(); const bundle = await bundleSource(compiled); cold['bundleSource (esbuild service start)'] = performance.now() - t;
  for (let i = 0; i < o.runs; i++) { t = performance.now(); await bundleSource(compiled); push(warm, 'bundleSource', performance.now() - t); }
  const variants: Array<[string, string[]]> = [
    ['node --no-node-snapshot (shipped)', [process.execPath, '--no-node-snapshot', WORKER]],
    ['node (snapshot on)', [process.execPath, WORKER]],
  ];
  for (const [label, args] of variants) {
    const first = await workerOnce(bundle, args);
    cold[`${label}: spawn → ready`] = first.spawnToReady;
    for (let i = 0; i < o.runs; i++) {
      const w = await workerOnce(bundle, args);
      push(warm, `${label}: spawn → ready`, w.spawnToReady);
      push(warm, `${label}: run → result (isolate + eval + call)`, w.runToResult);
      push(warm, `${label}: worker-reported isolate wall`, w.workerWall);
      push(warm, `${label}: SIGKILL → exit`, w.killToExit);
    }
  }
  if (o.image) {
    for (let i = 0; i < Math.min(o.runs, 20); i++) {
      const name = `afbin-bench-${randomUUID()}`;
      t = performance.now(); await exec('docker', dockerArgs(o.image, name)); push(warm, 'docker create', performance.now() - t);
      const w = await workerOnce(bundle, ['docker', 'start', '-a', '-i', name], process.env);
      push(warm, 'docker start -a → ready', w.spawnToReady); push(warm, 'docker: run → result', w.runToResult);
      t = performance.now(); await exec('docker', ['rm', '-f', name], true); push(warm, 'docker rm -f (as local.ts: --rm may already be removing it)', performance.now() - t);
    }
  }
  return { mode: 'micro', note: 'stages of one run, timed outside the runner', cold, warm, concurrent: {} };
}

// ---------- runner modes: createBackendInvoker against a real createRunner ----------

interface CallSample { calledAt: number; startResolvedAt?: number; observedAt?: number; polls: number; receipt?: RunReceipt | null }
/** Wraps the service the invoker sees; product code is unchanged. Samples are keyed by run. */
function instrument(inner: RunnerService, pending: CallSample[]) {
  const byRun = new Map<string, CallSample>();
  const service: RunnerService = {
    // Invocations reach start() in call order (their load() resolves in order), so a FIFO pairs them.
    async start(request: RunStart) { const sample = pending.shift()!; const r = await inner.start(request); sample.startResolvedAt = Date.now(); byRun.set(r.runId, sample); return r; },
    async getRun(lookup) {
      const snapshot = await inner.getRun(lookup); const sample = byRun.get(lookup.runId);
      if (sample) { sample.polls++; if (snapshot.status === 'completed' && sample.observedAt === undefined) { sample.observedAt = Date.now(); const raw = snapshot.receipt as unknown; sample.receipt = typeof raw === 'string' ? JSON.parse(raw) as RunReceipt : snapshot.receipt; } }
      return snapshot;
    },
    events: lookup => inner.events(lookup), cancel: lookup => inner.cancel(lookup),
  };
  return service;
}
function split(sample: CallSample, total: number): Record<string, number> {
  const r = sample.receipt; if (!r || !sample.startResolvedAt || !sample.observedAt) throw Error('incomplete_sample');
  const admitted = Date.parse(r.admittedAt), started = Date.parse(r.startedAt!), finished = Date.parse(r.finishedAt!);
  const stages: Record<string, number> = {
    'total (invoke → value)': total,
    'admit: start() (lookup + bundleSource + insert)': sample.startResolvedAt - sample.calledAt,
    'queue: admittedAt → startedAt': started - admitted,
    'execute: startedAt → finishedAt (worker, isolate, call, kill)': finished - started,
    'observe: finishedAt → completed getRun (persist + wait reply)': sample.observedAt - finished,
    'getRun calls': sample.polls,
  };
  return stages;
}
const addAll = (series: Series, stages: Record<string, number>) => { for (const [k, v] of Object.entries(stages)) push(series, k, v); };

async function runnerMode(mode: 'runner' | 'http' | 'docker', compiled: string, o: Options): Promise<ModeResult> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { createRunner } = await import('@artifactbin/runner/local');
  const { runnerHttp, runnerClient } = await import('@artifactbin/runner');
  const { overHttp } = await import('@artifactbin/utils');
  const { createBackendInvoker } = await import('@/lib/page-operations');
  const { serve } = await import('@hono/node-server');
  const { typeDefs } = JSON.parse(compiled) as { typeDefs: string; compiled: string };
  const program = (JSON.parse(compiled) as { compiled: string }).compiled;
  const db = new PGlite();
  // Production's controller allows 8 concurrent runs (artifactbin-server compose, RUNNER__MAX_CONCURRENT).
  const local = await createRunner({ db, maxConcurrent: 8, ...(o.prestart === undefined ? {} : { prestartedWorkers: o.prestart }), ...(mode === 'docker' ? { dockerImage: o.image } : {}), capabilities: async () => { throw Error('no_capabilities'); } });
  let service: RunnerService = local, close = async () => {};
  if (mode === 'http') {
    const secret = randomBytes(32).toString('hex');
    const server = serve({ fetch: runnerHttp(local, secret).fetch, hostname: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    service = runnerClient(base, overHttp(base, secret));
    close = () => new Promise<void>(resolve => server.close(() => resolve()));
  }
  const pending: CallSample[] = [];
  const record = { backendId: 'bench', version: '1', source: SOURCE, ownerId: 'bench-owner', pageId: 'bench-page', typeDefs, compiled: program, api: 2 as const };
  const invoke = createBackendInvoker(instrument(service, pending), async () => record);
  const call = async (): Promise<[CallSample, number]> => {
    const sample: CallSample = { calledAt: Date.now(), polls: 0 }; pending.push(sample);
    const t = performance.now();
    const value: HtmlJson = await invoke({ namespace: 'bench', fileId: 'bench', version: '1', operation: 'query', field: 'ping', args: {}, principal: { tenant: 'bench-page', subject: null, role: 'anonymous' as const }, signal: AbortSignal.timeout(30_000) });
    if (value !== 'pong') throw Error(`unexpected ${JSON.stringify(value)}`);
    return [sample, performance.now() - t];
  };
  const warm: Series = {}, concurrent: Series = {};
  let cold: Record<string, number> = {};
  try {
    const [first, firstTotal] = await call(); cold = split(first, firstTotal);
    for (let i = 0; i < o.warmup; i++) await call();
    for (let i = 0; i < o.runs; i++) { const [s, total] = await call(); addAll(warm, split(s, total)); }
    for (let b = 0; b < o.batches; b++) {
      const results = await Promise.all(Array.from({ length: o.concurrent }, () => call()));
      for (const [s, total] of results) addAll(concurrent, split(s, total));
    }
  } finally { await close(); await local.close(); await db.close(); }
  const note = { runner: 'in-process runner, node child per run (local composition)', http: 'runner behind runnerHttp + signed runnerClient on loopback (production shape, without the dispatcher)', docker: `runner with dockerImage=${o.image} (container per run; not used by production resolvers)` }[mode];
  return { mode, note, cold, warm, concurrent };
}

// ---------- app: page GraphQL on the running dev server ----------

async function appMode(o: Options): Promise<ModeResult> {
  const { readDotEnv } = await import('./lib/env');
  const { acquireCredential } = await import('./lib/credential');
  const env = readDotEnv(path.join(ROOT, '.env'));
  const base = o.base ?? env.APP__PUBLIC_BASE_URL ?? `http://localhost:${env.APP__PORT ?? 3030}`;
  const outbox = env.EMAIL__DEV_OUTBOX_PATH || path.join(ROOT, '.artifactbin', 'dev-mail.jsonl');
  const { token } = await acquireCredential('outbox-oauth', { grant: 'http-email', base, origin: base, env: {}, localOutbox: outbox, email: `mxmx_test_resolver_bench_${Date.now()}@example.com` });
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const html = '<html><head><link rel="af-resolver" data-af-name="bench" href="./bench.ts"></head><body><p>Resolver latency benchmark</p></body></html>';
  const created = await fetch(`${base}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify({ html, title: 'Resolver latency benchmark', resolverSources: { bench: SOURCE } }) });
  if (created.status !== 201) throw Error(`publish ${created.status}: ${await created.text()}`);
  const { id, version } = await created.json() as { id: string; version?: number | string };
  const revision = String(version ?? 1);
  const query = async (q: string) => {
    const t = performance.now();
    const response = await fetch(`${base}/api/artifacts/${id}/graphql`, { method: 'POST', headers, body: JSON.stringify({ revision, query: q }) });
    const body = await response.json() as { data?: unknown; errors?: unknown };
    if (response.status !== 200 || body.errors) throw Error(`graphql ${response.status}: ${JSON.stringify(body)}`);
    return performance.now() - t;
  };
  const cold: Record<string, number> = {}, warm: Series = {}, concurrent: Series = {};
  cold['resolver field: first call after publish'] = await query(QUERY);
  for (let i = 0; i < o.warmup; i++) { await query(QUERY); await query(BASELINE); }
  for (let i = 0; i < o.runs; i++) { push(warm, 'baseline { __typename } (no resolver)', await query(BASELINE)); push(warm, `resolver field ${QUERY}`, await query(QUERY)); }
  for (let b = 0; b < o.batches; b++) for (const ms of await Promise.all(Array.from({ length: o.concurrent }, () => query(QUERY)))) push(concurrent, `resolver field ${QUERY}`, ms);
  await fetch(`${base}/api/artifacts/${id}`, { method: 'DELETE', headers }).catch(() => {});
  return { mode: 'app', note: `page GraphQL on ${base} (dev composition, local runner)`, cold, warm, concurrent };
}

// ---------- driver ----------

async function compile(): Promise<string> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { createRunner } = await import('@artifactbin/runner/local');
  const { setServices } = await import('@/lib/platform');
  const { compilePageBackend } = await import('@/lib/page-operations');
  const db = new PGlite();
  const runner = await createRunner({ db, capabilities: async () => null });
  setServices({ runner });
  try { const c = await compilePageBackend(SOURCE); return JSON.stringify({ typeDefs: c.typeDefs, compiled: c.compiled }); }
  finally { await runner.close(); await db.close(); }
}

async function inChild(mode: string, compiledFile: string, o: Options): Promise<ModeResult> {
  const argv = ['--runs', o.runs, '--warmup', o.warmup, '--concurrent', o.concurrent, '--batches', o.batches].map(String).concat(o.image ? ['--image', o.image] : [], o.prestart === undefined ? [] : ['--prestart', String(o.prestart)]);
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), ...argv, '--child', mode, '--compiled', compiledFile], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; child.stdout.on('data', (b: Buffer) => { out += b.toString(); });
  const [code] = await once(child, 'close') as [number];
  if (code !== 0) throw Error(`${mode} exited ${code}`);
  return JSON.parse(out.slice(out.lastIndexOf('\n{') + 1)) as ModeResult;
}

async function main() {
  const argv = process.argv.slice(2), o = parse(argv);
  if (o.child) {
    const compiled = fs.readFileSync(o.compiled!, 'utf8');
    const result = o.child === 'micro' ? await micro((JSON.parse(compiled) as { compiled: string }).compiled, o) : await runnerMode(o.child as 'runner' | 'http' | 'docker', compiled, o);
    process.stdout.write('\n' + JSON.stringify(result) + '\n');
    return;
  }
  const known = ['micro', 'runner', 'http', 'docker', 'app'];
  for (const m of o.modes) if (!known.includes(m)) throw Error(`unknown mode ${m}; known: ${known.join(', ')}`);
  if (o.modes.includes('docker') && !o.image) throw Error('--modes docker needs --image <worker image>');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-latency-'));
  const compiledFile = path.join(dir, 'compiled.json');
  fs.writeFileSync(compiledFile, await compile());
  const results: ModeResult[] = [];
  for (const mode of o.modes) {
    process.stderr.write(`[resolver-latency] ${mode}…\n`);
    results.push(mode === 'app' ? await appMode(o) : await inChild(mode, compiledFile, o));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const meta = { revision: (() => { try { return gitOut('git', ['rev-parse', '--short', 'HEAD']); } catch { return '?'; } })(), prestart: o.prestart ?? 'runner default', node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: `${os.cpus().length} × ${os.cpus()[0]?.model ?? '?'}`, runs: o.runs, warmup: o.warmup, concurrent: `${o.batches} × ${o.concurrent}`, at: new Date().toISOString() };
  let report = `# Resolver latency\n\n${Object.entries(meta).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
  for (const r of results) {
    report += `\n## ${r.mode} — ${r.note}\n\n`;
    report += table('Cold (first call in a fresh process)', Object.fromEntries(Object.entries(r.cold).map(([k, v]) => [k, [v]])));
    report += '\n' + table(`Warm (${o.runs} serial after ${o.warmup} warm-ups)`, r.warm);
    report += '\n' + table(`Concurrent (${o.batches} batches of ${o.concurrent})`, r.concurrent);
  }
  process.stdout.write(report);
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ meta, results }, null, 1));
}

await main();
