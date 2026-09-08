#!/usr/bin/env node
/**
 * Run the browser gates as a SET.
 *
 *   node scripts/gates.mjs [base-url ...] [--only=a,b] [--list] [--servers=N] [--shard=i/n]

 * With no base URL it BUILDS NOTHING but boots `min(6, cores)` servers from
 * dist/ — run `npm run build` first, exactly as CI does.
 *
 * Every gate is a standalone script that drives a running server and exits
 * non-zero when a contract breaks. Individually they were runnable and
 * individually they were run — but nothing ever ran them all, nothing listed
 * them, and nine of the twenty-seven were referenced by no script, no CI job
 * and no doc. A gate nobody can enumerate is a gate nobody runs, and several
 * guard invariants CLAUDE.md describes as load-bearing.
 *
 * So the list is DISCOVERED from disk rather than written down: a new
 * `scripts/gate-*.mjs` joins the set by existing, and cannot go missing from a
 * hand-maintained list it was never added to.
 *
 * PARALLEL BY SERVER, SEQUENTIAL BY WORKER. The set took ~25 minutes in one
 * file because it ran one gate at a time, and the reason it had to was never
 * the browser: it was the SERVER. Gates seed real documents, several are named
 * in one process's in-memory caches, and every one of them mints from the same
 * IP — so two gates sharing a server share a mint ceiling, a login door and a
 * listing. Give each worker its OWN server and all three go away: no shared
 * counter, no shared row, nothing to race. Within a worker the gates still run
 * one at a time, because a gate's own seeding is sequential and its mail sink
 * is a port it binds alone.
 *
 * So the fan-out is over SERVERS, not over gates: pass several base URLs and
 * the set is dealt across them, or let this runner boot them itself (in-memory
 * PGLite, its own object dir, its own port) from the build in dist/.
 *
 * BOOTING THEM IS NOW THE DEFAULT, and that is the second half of the same
 * lesson. With no arguments the runner used to drive whatever was listening on
 * :3040 — a DEV server — and a local run therefore did not mean what CI's run
 * means. CI builds and boots the bundle (`.github/workflows/ci.yml`:
 * `npm run build`, then `gates.mjs --servers=4`); a dev server serves the SPA
 * through Vite, whose HMR websocket is on a second port that the app's fixed
 * `connect-src 'self'` CSP refuses, so the SPA never mounts and every gate
 * waiting on the artifact iframe or a chart's marks times out. MEASURED: 26 of
 * 42 gates failed that way on a clean checkout, and the SAME 26 failed on a
 * commit that had changed nothing. So with no base URL the default is
 * `min(6, availableParallelism())` servers of the CI shape
 * (scripts/gates.servers.mjs). `--servers=N` still wins — `--servers=1` is a
 * SERIAL run, for debugging one gate's interference, and `--servers=0` asks for
 * the old "drive :3040" behaviour — and a base URL still means DRIVE THAT
 * SERVER. The run prints how many servers and how many gates before it starts
 * and the wall-clock when it ends, so a serial run is visible in any log.
 *
 * A BOOTED SERVER IS PRODUCTION-MODE, SO IT NEEDS THE DEV POLICY FILE. The
 * shipped default closes anonymous minting outright, and a full pass mints far
 * more than a handful of anonymous tokens from one IP — so every gate after the
 * ceiling would die on a 429 the START helper reports as `401 unauthorized` at
 * publish time, which reads like a broken build and is not one. `bootServer`
 * points each one at `services/proxy/dev_rate_limits.yml` (2000/hour). Driving
 * a server of your own, set `PROXY__RATE_LIMIT_CONFIG_FILE` to the same file.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GATE_SPECS, checkManifest, specFor } from './gates.manifest.mjs';
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
      ...process.env,
      NODE_ENV: 'production',
      // The gate's Google sheet is answered locally (scripts/lib/sheets-stub.mjs):
      // same URL, no third party on a merge gate. APPENDED rather than set, so a
      // NODE_OPTIONS the caller already has survives.
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(path.join(HERE, 'lib/sheets-stub.mjs')).href}`.trim(),
      APP__PORT: String(port),
      APP__PUBLIC_BASE_URL: base,
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
      WEB_INGEST__ALLOW_PRIVATE: process.env.WEB_INGEST__ALLOW_PRIVATE ?? '1',
      ...(mailOutbox ? { EMAIL__DEV_OUTBOX_PATH: mailOutbox } : {}),
    },
  });
  started.push(child);
  await waitForServer(base, child);
  return base;
}

const stopAll = () => { for (const child of started) { try { child.kill('SIGTERM'); } catch { /* gone */ } } };
process.on('exit', () => { stopAll(); try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopAll(); process.exit(130); });

let targets = bases;
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
if (targets.length === 0) targets = ['http://localhost:3040'];

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
    env: { ...process.env, ...(mailOutbox ? { EMAIL__DEV_OUTBOX_PATH: mailOutbox } : {}) },
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
stopAll();

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
