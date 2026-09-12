#!/usr/bin/env node
/**
 * Run the browser gates as a SET.
 *
 *   node scripts/gates.mjs [base-url ...] [--only=a,b] [--list] [--servers=N] [--shard=i/n]
 *
 * The set is DISCOVERED from disk — a new `scripts/gate-*.mjs` joins by
 * existing — and every gate must have a row in gates.manifest.mjs, which says
 * what it needs and how long it may take.
 *
 * PARALLEL BY SERVER, SEQUENTIAL BY WORKER. Gates seed real documents and mint
 * from one IP, so two sharing a server share a ceiling, a login door and a
 * listing; each worker gets its OWN server (in-memory PGLite, its own object
 * dir, its own port) and those collisions go away. `--servers=1` is a serial
 * run, for debugging one gate's interference.
 *
 * With no base URL it boots `min(6, cores)` servers from dist/ in production
 * mode — run `npm run build` first, exactly as CI does. A dev server is not a
 * substitute: its HMR websocket trips the app's fixed `connect-src 'self'`, so
 * the SPA never mounts and every gate times out. A base URL means DRIVE THAT
 * SERVER, and a booted one is pointed at `services/proxy/dev_rate_limits.yml`
 * (2000/hour) because the shipped default closes the start_doc door outright
 * and a full pass starts far more documents than that from one address.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_SPECS, checkManifest, specFor } from './gates.manifest.mjs';
import {startGenerationFixture} from './lib/generation-fixture.mjs';
import { resolveServers, runSecret } from './gates.servers.mjs';
import { parseShard, shardOf } from './gates.shard.mjs';
import { loadDotEnv } from './lib/dev-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const BUNDLE = path.join(ROOT, 'dist/proxy-server.mjs');

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean);
const bases = args.filter((a) => !a.startsWith('--'));
let servers;
let serversFrom;
try {
  ({ servers, source: serversFrom } = resolveServers({ args, bases, cpus: os.availableParallelism?.() }));
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}
let shard;
try {
  shard = parseShard(args.find((a) => a.startsWith('--shard=')));
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}

/** Every gate on disk, by short name (`gate-visibility.mjs` → `visibility`). */
const GATES = readdirSync(HERE)
  .filter((f) => f.startsWith('gate-') && f.endsWith('.mjs'))
  .sort()
  .map((file) => ({ name: file.slice('gate-'.length, -'.mjs'.length), file }));

try {
  checkManifest(GATES.map((gate) => gate.name), GATE_SPECS);
} catch (error) {
  console.error(String(error));
  process.exit(2);
}

if (args.includes('--list')) {
  for (const g of GATES) console.log(g.name);
  process.exit(0);
}

const chosen = only ? GATES.filter((g) => only.includes(g.name)) : GATES;
// The shard is taken AFTER --only, so `--only=a,b --shard=1/2` means "half of
// those two" rather than "whichever of them fell in shard 1 of the whole set".
const selected = shard
  ? (() => {
      const names = shardOf(chosen.map((g) => g.name), shard, (name) => specFor(name).timeoutMs);
      return chosen.filter((g) => names.includes(g.name));
    })()
  : chosen;
if (selected.length === 0) {
  console.error(`No gate matched --only=${only?.join(',')}. Known: ${GATES.map((g) => g.name).join(', ')}`);
  process.exit(2);
}

/** A port nothing holds right now — asked of the OS, not guessed. */
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const answers = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).status < 500; } catch { return false; }
};

const waitForServer = async (base, child) => {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`server for ${base} exited with ${child.exitCode}`);
    if (await answers(base)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${base} never answered`);
};

const started = [];
const scratch = path.join(os.tmpdir(), `artifact-gates-${process.pid}`);

/**
 * A worker's own server: in-memory PGLite and its own object dir, so two
 * workers share no row, no key and no counter. Everything else — the auth
 * secret, the mail endpoint, S3 if the caller set one — is inherited, because
 * a gate run is only as honest as the environment it runs against.
 */
async function bootServer(index, mailOutbox, authSecret) {
  if (!existsSync(BUNDLE)) {
    console.error(`--servers needs a build: ${path.relative(ROOT, BUNDLE)} is missing. Run \`npm run build\`.`);
    process.exit(2);
  }
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const objects = path.join(scratch, `objects-${index}`);
  mkdirSync(objects, { recursive: true });
  const child = spawn(process.execPath, [BUNDLE], {
    cwd: path.join(ROOT, 'services/app'),
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GENERATION__'))),
      NODE_ENV: 'production',
      // Fixture credentials are always isolated from operator model settings.
      GENERATION__MODELS: generationFixture?.models ?? '',
      GENERATION__FIXTURE_KEY: generationFixture ? 'fixture-only-key' : '',
      APP__PORT: String(port),
      APP__PUBLIC_BASE_URL: base,
      // Managed iframe assets are served by the same disposable app through a
      // dedicated first-party hostname, matching the production trust split.
      APP__ASSETS_ORIGIN: `http://assets.localhost:${port}`,
      // Production mode refuses to boot without it; CI hands its gates job one per run and so do we
      // (scripts/gates.servers.mjs runSecret). Every server in the run shares the one value.
      AUTH__SECRET: authSecret,
      DATABASE_URL: 'pglite://memory',
      // A seeded worktree names standalone service ports in .env. Throwaway
      // gate servers deliberately use the full bundle's local implementations —
      // and EVENTS is the same story with a quieter failure: left set, every
      // booted server spends the run logging ECONNREFUSED at a log service
      // nobody started. Unset means the app writes its own events, in process.
      SQL__SERVICE_URL: '',
      BROWSER__SERVICE_URL: '',
      EVENTS__SERVICE_URL: '',
      // A .env written for the dev server names ITS port for the exporter's
      // fetch; inherited unchanged, every booted server would fetch from the
      // machine's other server. It is per-process.
      EXPORT__INTERNAL_ORIGIN: `http://127.0.0.1:${port}`,
      OBJECT_STORE__LOCAL_DIR: objects,
      ARTIFACTS__ALLOW_PUBLIC: process.env.ARTIFACTS__ALLOW_PUBLIC ?? '1',
      PROXY__RATE_LIMIT_CONFIG_FILE: process.env.PROXY__RATE_LIMIT_CONFIG_FILE ?? path.join(ROOT, 'services/proxy/dev_rate_limits.yml'),
      // A gate's "web" is a fixture host on 127.0.0.1, and a production-mode
      // server refuses to fetch one (lib/web-ingest/guard) — the same reason
      // the mint ceiling is raised here rather than in the gate.
      // Disposable fixture servers must not inherit the production .env's
      // deny-loopback switch: their deterministic "web" lives on loopback.
      // The metadata/link-local denials remain enforced even in this mode.
      WEB_INGEST__ALLOW_PRIVATE: '1',
      // The PostgreSQL gate likewise uses a disposable loopback database,
      // matching the CI browser-gate environment rather than production.
      DATASET__ALLOW_PRIVATE_NETWORKS: 'true',
      ...(mailOutbox ? { EMAIL__DEV_OUTBOX_PATH: mailOutbox } : {}),
    },
  });
  started.push(child);
  await waitForServer(base, child);
  return base;
}

const alive = (child) => child.exitCode === null && child.signalCode === null;
/** Every server this run booted is gone before it is — SIGKILL is the guarantee. */
const kill = (signal) => { for (const child of started) { if (alive(child)) { try { child.kill(signal); } catch { /* gone */ } } } };
/**
 * A production-mode app takes its time over a graceful close, and a finished
 * gate run has nothing left to be graceful about. SIGTERM alone left one
 * server per run behind — MEASURED: nine of them, oldest forty minutes, each
 * holding a port and a Chromium-shaped amount of memory. So: ask, wait, insist.
 */
const stopAll = async () => {
  kill('SIGTERM');
  const deadline = Date.now() + 2000;
  while (started.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  kill('SIGKILL');
};
// The last word, for the paths that cannot await: an uncaught throw, a signal,
// `process.exit` from anywhere. A SIGKILLed RUNNER can still leak — nothing in
// it can run then — which is why the escalation above exists at all.
process.on('exit', () => { kill('SIGKILL'); try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { kill('SIGKILL'); process.exit(130); });
}

let targets = bases;
// The fixture model server is a ROW's requirement, not a name the runner knows.
const generationFixture = servers > 0 && selected.some((gate) => specFor(gate.name).needsGenerationFixture)
  ? await startGenerationFixture()
  : null;
const needsMail = selected.some((gate) => specFor(gate.name).needsMail);
const mailOutbox = needsMail && servers > 0 ? path.join(scratch, 'dev-mail.jsonl') : null;
if (servers > 0) {
  // The servers this boots are the real thing: they want the auth secret, the
  // mail key and whatever store the caller configured, all of which live where
  // `npm run dev` finds them.
  loadDotEnv();
  const authSecret = runSecret(process.env);
  process.stdout.write(`booting ${servers} server(s)${serversFrom === 'default' ? ' (one per core, capped — pass --servers=N to choose, or a base URL to drive a server you already have)' : ''}`);
  targets = await Promise.all(Array.from({ length: servers }, (_, i) => bootServer(i, mailOutbox, authSecret)));
  console.log(` — ${targets.join(' ')}\n`);
}
if (targets.length === 0) {
  console.error('Nothing to drive: pass base URLs, or --servers=N with N > 0.');
  process.exit(2);
}

/*
 * SAY HOW WIDE THE RUN IS, BEFORE IT RUNS. A serial pass and a parallel one differ by an order of magnitude
 * in wall-clock and by nothing at all in output, so a log that does not say which it was cannot be read
 * afterwards — and the failure mode this guards is silent: a `--servers=1` somewhere upstream turns a
 * three-minute set into half an hour and looks exactly like a slow machine.
 */


/**
 * A gate's verdict is its EXIT CODE — the summary text is for the human, and
 * it is BUFFERED rather than inherited: several gates writing to one terminal
 * at once is a log nobody can read a failure out of.
 */
const run = (gate, base, timeoutMs) => new Promise((resolve) => {
  const started_at = Date.now();
  const child = spawn(process.execPath, [path.join(HERE, gate.file), base], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(generationFixture ? {GENERATION_FIXTURE_URL:generationFixture.url} : {}), ...(mailOutbox ? { EMAIL__DEV_OUTBOX_PATH: mailOutbox } : {}) },
  });
  let output = '';
  let settled = false;
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  const done = (ok) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve({ ok, output, seconds: (Date.now() - started_at) / 1000 });
  };
  const timer = setTimeout(() => {
    const seconds = timeoutMs / 1000;
    output += `${output.endsWith('\n') ? '' : '\n'}timed out after ${seconds} s\n`;
    child.kill('SIGTERM');
    done(false);
  }, timeoutMs);
  child.on('close', (code) => done(code === 0));
  child.on('error', () => done(false));
});

/** Promise tails are group locks: unrelated gates still fan out, while a gate
 * waits for the previous member of its serial group even on another worker. */
const serialGroups = new Map();
const withinSerialGroup = (serialGroup, task) => {
  if (!serialGroup) return task();
  const previous = serialGroups.get(serialGroup) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  serialGroups.set(serialGroup, current);
  return current;
};

console.log(`gates: ${targets.length} server(s), ${selected.length} gate(s)${serversFrom === 'default' ? ' (default: one per core, capped at 6 — --servers=1 is serial, for debugging)' : ''}\n`);
const queue = [...selected];
const failed = [];
const timings = [];
const wall = Date.now();

/** One worker per server, each pulling the next gate — so a slow gate delays
 *  only its own worker and the set finishes when the last one does. */
await Promise.all(targets.map(async (base) => {
  for (let gate = queue.shift(); gate; gate = queue.shift()) {
    const spec = specFor(gate.name);
    const { ok, output, seconds } = await withinSerialGroup(
      spec.serialGroup,
      () => run(gate, base, spec.timeoutMs),
    );
    timings.push({ name: gate.name, seconds });
    if (!ok) failed.push(gate.name);
    console.log(`──────── ${gate.name} ${ok ? '' : 'FAILED '}(${seconds.toFixed(0)}s) ────────`);
    console.log(output.trimEnd());
    console.log('');
  }
}));

/*
 * A gate that failed under load gets ONE more turn, ALONE.
 *
 * Fanning out is what made the set affordable, and it costs something real:
 * four browsers and four servers on one machine, so a gate with a 10-second
 * wait in it can lose that race and fail for no reason of its own. Two
 * consecutive full runs each failed exactly one gate, and a DIFFERENT one,
 * and both passed alone — that is contention, not a broken contract.
 *
 * Retrying blindly would hide a real intermittent bug, so the retry is
 * REPORTED: a gate that needed it is named in the summary, and a gate that
 * fails twice fails. CI runs this, so the verdict has to be worth trusting in
 * both directions — no red for a lost race, no green that quietly swallowed
 * a genuine flake.
 */
const retried = [];
if (failed.length > 0 && targets.length > 1) {
  console.log(`\n──────── retrying ${failed.length} gate(s) alone ────────`);
  for (const name of [...failed]) {
    const gate = selected.find((g) => g.name === name);
    const spec = specFor(gate.name);
    const { ok, output, seconds } = await run(gate, targets[0], spec.timeoutMs);
    if (!ok) { console.log(output.trimEnd()); continue; }
    failed.splice(failed.indexOf(name), 1);
    retried.push(name);
    console.log(`  ${name} passed alone in ${seconds.toFixed(0)}s — it lost the race, not the contract`);
  }
}

// The servers are OURS and they outlive the last gate: node keeps running
// while a spawned child is attached, so the set would finish and then hang.
await stopAll();
await generationFixture?.close();

console.log('════════ gates ════════');
console.log(`${selected.length - failed.length}/${selected.length} passed in ${((Date.now() - wall) / 1000).toFixed(0)}s wall-clock across ${targets.length} server(s)`);
if (retried.length) console.log(`needed a retry alone (contention, not a fault): ${retried.join(', ')}`);
// The slowest few, because the set's wall time is now the slowest WORKER's —
// and one long gate is what a worker's queue ends up waiting on.
console.log(`slowest: ${timings.sort((a, b) => b.seconds - a.seconds).slice(0, 5)
  .map((t) => `${t.name} ${t.seconds.toFixed(0)}s`).join(', ')}`);
if (failed.length) {
  console.log(`FAILED: ${failed.join(', ')}`);
  // Named individually so a re-run of just the broken ones is a copy-paste.
  console.log(`re-run: node scripts/gates.mjs ${bases[0] ?? ''} --only=${failed.join(',')}`.replace(/\s+/g, ' '));
  process.exit(1);
}
console.log('all gates passed');
process.exit(0);
