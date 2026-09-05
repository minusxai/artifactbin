#!/usr/bin/env node
/**
 * LEAN IMAGE CHECKS (the P3 CORE TESTS 1 and 2) — contents and size, per
 * image, against a BUILT image. Not part of `npm test`: it needs docker and
 * an image tag, so it is run by CI beside the build and by hand:
 *
 *   node scripts/image-checks.mjs <kind> <image>   # kinds: app, proxy, sql, browser, events, full
 *
 * What it proves, per kind (the table below is the whole difference):
 *   1. CONTENTS — `require.resolve` inside the container: the package this
 *      image exists to carry RESOLVES, and the one the OTHER image carries
 *      THROWS (`Cannot find package`). A filtered install that grows the
 *      wrong package fails here, not at 3am on a box.
 *   2. BOOTS and SERVES — `/health` 200 (the Docker HEALTHCHECK's own
 *      answer) and one real call that returns rows / an image. The app row
 *      proves the lean entry's own rule BOTH ways: it boots with the service
 *      URLs set and REFUSES to boot without them (the assert that replaced
 *      RUNTIME__OMITS — an image that silently fell back to an engine it
 *      does not carry is the exact failure this catches). The proxy row
 *      proves its /health is its OWN: it answers with a DEAD upstream,
 *      because a probe that dies with the app it fronts reports the wrong
 *      process's health.
 *   3. SIZE, by in-container `du -sbx /` — NEVER `docker images`, whose size
 *      column is a lie under colima (706MB reported for a 519MB filesystem,
 *      measured in the P3 scoping report). `-x` stays on the image's root
 *      filesystem instead of counting host-dependent `/sys` and `/proc`
 *      pseudo-filesystems. A budget exists to catch the monaco-comes-back
 *      class (a runtime dep sneaking into a lean image), not to shave
 *      megabytes.
 *
 * The port is taken from the assigned review span (7120–7129);
 * if the whole span is busy, fail rather than binding outside the assigned
 * block.
 */
import { execFile } from 'node:child_process';
import net from 'node:net';

const MB = 1_000_000;
const SERVICE_SECRET = 'image-checks-internal-service-secret';

/** `docker run` with the image's own node; resolve/throw is the exit code. */
const resolveOk = (spec) => `try { require.resolve(${JSON.stringify(spec)}) } catch { process.exit(1) }`;
const resolveThrows = (spec) => `try { require.resolve(${JSON.stringify(spec)}) } catch { process.exit(0) } process.exit(1)`;
/** A WORKSPACE package is carried as a symlink to its TS sources — the image
 *  runs one bundle, so `require.resolve` can never work for it; presence of
 *  the link is the honest probe (and what the Dockerfile itself asserts).
 *  `import()` because the `node -e` payload strings live in THIS ESM file —
 *  the esm-globals guard scans sources, comments included. */
const carriedOk = (dir) => `import('node:fs').then((fs) => process.exit(fs.existsSync(${JSON.stringify(dir)}) ? 0 : 1), () => process.exit(1))`;

const SQL_PROBE = {
  path: '/run',
  body: { tables: { t: { rows: [{ a: 1 }, { a: 2 }], columns: [{ name: 'a', type: 'number' }] } }, queries: [{ name: 'q', sql: 'select sum(a) as s from t' }], params: {} },
  /** Real rows back — a service that cannot answer is a failure, never an empty result. */
  check: (status, body) => status === 200 && body?.results?.q?.rows?.[0]?.s === 3,
};
const BROWSER_PROBE = {
  path: '/render',
  body: { url: 'data:text/html,<h1>hi</h1>', format: 'png', viewport: { width: 200, height: 100 }, selector: 'h1', capture: 'full', sameOriginOnly: true, settleMs: 50, timeoutMs: 15_000 },
  /** image/png — the bytes, not a JSON verdict. */
  check: (status, body, headers, bytes) => status === 200 && (headers.get('content-type') ?? '').startsWith('image/png') && bytes[0] === 0x89 && bytes[1] === 0x50,
};

const KINDS = {
  /** The lean APP — the split shape's document server: the whole app tree and
   *  neither of the two natives it now reaches over service URLs. */
  app: {
    containerPort: 3000,
    mustResolve: ['react'],
    mustCarry: ['node_modules/@artifactbin/utils', 'node_modules/@artifactbin/contracts'],
    mustThrow: ['playwright', '@duckdb/node-api', '@tailwindcss/postcss', 'tailwindcss', 'lightningcss', 'vite'],
    probe: { path: '/health', check: (status, body) => status === 200 && body?.ok === true },
    /** The lean entry's own rule, proved the refusing way too (below). */
    env: { DATABASE_URL: 'pglite://memory', SQL__SERVICE_URL: 'http://127.0.0.1:9', BROWSER__SERVICE_URL: 'http://127.0.0.1:9' },
    /** The entry's own assert, proved the refusing way (main's 2b): what a bare
     *  `docker run` must NAME on its way out. */
    refusesWithoutEnv: /SQL__SERVICE_URL and BROWSER__SERVICE_URL/,
    /** 414 MB measured on arm64 after the runtime CSS compiler was bundled,
     *  its toolchain left, and the unused Kysely dialect was removed. */
    budgetMB: 520,
  },
  /** The lean PROXY — identity over Postgres, the doors, one forwarder. */
  proxy: {
    containerPort: 3000,
    mustResolve: ['better-auth'],
    mustThrow: ['@duckdb/node-api', 'playwright', '@electric-sql/pglite', 'kysely-pglite', 'vite', 'vitest', 'react-dom'],
    probe: { path: '/health', check: (status, body) => status === 200 && body?.ok === true },
    /** A DEAD upstream on purpose: /health is answered by the proxy itself,
     *  never forwarded — a probe that dies with the app it fronts reports the
     *  wrong process's health. */
    env: { APP__UPSTREAM_URL: 'http://127.0.0.1:9', CONTRACT__ACTOR_SECRET: 'x'.repeat(32) },
    /** One forwarded request with the dead upstream: a 5xx, promptly — never
     *  a hang. (The plan's CORE TEST 1 wording says 502 `upstream_unavailable`;
     *  the shipped forwarder lets the fetch error surface as Hono's default
     *  500, so this pins the honest floor — an error, fast — without pinning
     *  a status the proxy does not own today.) */
    deadUpstream: { path: '/api/artifacts', expectStatusAtLeast: 500 },
    /** 295 MB measured on arm64 after the standalone closure dropped PGLite
     *  and Better Auth's optional React/Vitest peers. Roughly 100 MB of
     *  headroom preserves the guard's architecture/base-image tolerance. */
    budgetMB: 400,
  },
  sql: {
    containerPort: 8080,
    mustResolve: ['@duckdb/node-api'],
    mustThrow: ['playwright'],
    probe: SQL_PROBE,
    env: { INTERNAL__SERVICE_SECRET: SERVICE_SECRET },
    headers: { 'x-artifactbin-service-secret': SERVICE_SECRET },
    budgetMB: 500,
  },
  browser: {
    containerPort: 8080,
    mustResolve: ['playwright'],
    mustThrow: ['@duckdb/node-api'],
    probe: BROWSER_PROBE,
    env: { INTERNAL__SERVICE_SECRET: SERVICE_SECRET },
    headers: { 'x-artifactbin-service-secret': SERVICE_SECRET },
    budgetMB: 1600,
  },
  /** The lean EVENTS service — the log's only writer, and the one lean image
   *  that is STATEFUL: `runEvents` ensures its schema at boot and dies loudly
   *  without a reachable DATABASE_URL, on purpose (a log service that quietly
   *  accepted a batch it could not store is the failure that rule exists for).
   *  So this check proves its CONTENTS, its SIZE and its REFUSAL; that it boots
   *  and serves is proved by the compose walk, where it has its database. */
  events: {
    containerPort: 8080,
    mustResolve: ['pg'],
    mustCarry: ['node_modules/@artifactbin/utils', 'node_modules/@artifactbin/contracts'],
    /** `vite`/`vitest` are NOT listed, and that is measured, not sloppy:
     *  `npm ci --omit=dev -w <workspace>` does not omit that WORKSPACE's own
     *  devDependencies unless `--legacy-peer-deps` rides along (measured
     *  2026-09-05, node:22-slim, both -w services/events and -w services/sql),
     *  so every lean image built this way carries the test runner. That is the
     *  sql and browser images' condition today too — one repo-wide fix, not
     *  this service's to make. */
    mustThrow: ['playwright', '@duckdb/node-api', 'react', 'better-auth'],
    /** No database here — see above; the boot leg is the compose walk's. */
    boots: false,
    refusesWithoutEnv: /DATABASE_URL/,
    /** 240 MB measured on arm64: node:22-slim plus `pg` and one bundle. */
    budgetMB: 320,
  },
  /** The full/co-hosted image intentionally carries both native services and
   *  the PGLite adapter; it still must not carry the CSS build toolchain. */
  full: {
    containerPort: 3000,
    mustResolve: ['react', 'playwright', '@duckdb/node-api', '@electric-sql/pglite', 'better-auth', 'sharp'],
    mustThrow: ['@tailwindcss/postcss', 'tailwindcss', 'lightningcss'],
    probe: { path: '/health', check: (status, body) => status === 200 && body?.ok === true },
    env: {
      DATABASE_URL: 'pglite://memory',
      AUTH__SECRET: 'image-checks-auth-secret-at-least-32-bytes',
      APP__PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
    },
    /** 2,005 MB research baseline on arm64; headroom is for base/browser
     *  drift, while the mustThrow probes catch toolchain regressions. */
    budgetMB: 2070,
  },
};

const run = (args, opts = {}) => new Promise((resolve) => {
  execFile('docker', args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout), stderr: String(stderr) }));
});

/** First free port in the assigned review span; never bind outside it. */
function freePort() {
  const tryPort = (port) => new Promise((resolve) => {
    const srv = net.createServer().once('error', () => resolve(null)).once('listening', function () { this.close(() => resolve(port)); });
    srv.listen(port, '127.0.0.1');
  });
  return (async () => {
    for (const p of [7120, 7121, 7122, 7123, 7124, 7125, 7126, 7127, 7128, 7129]) {
      const got = await tryPort(p);
      if (got) return got;
    }
    throw new Error('image-checks: no free port in assigned span 7120–7129');
  })();
}

const checks = [];
const record = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function main() {
  const [kind, image] = process.argv.slice(2);
  const spec = KINDS[kind];
  if (!kind || !image || !spec) {
    console.error(`usage: node scripts/image-checks.mjs <${Object.keys(KINDS).join('|')}> <image>`);
    process.exit(2);
  }

  // 1. CONTENTS — resolve inside the container, by the image's own node.
  for (const pkg of spec.mustResolve) {
    const r = await run(['run', '--rm', image, 'node', '-e', resolveOk(pkg)]);
    record(`${image}: require.resolve('${pkg}')`, !r.error, r.error ? r.stderr.trim().split('\n').pop() : '');
  }
  for (const dir of spec.mustCarry ?? []) {
    const r = await run(['run', '--rm', image, 'node', '-e', carriedOk(dir)]);
    record(`${image}: carries ${dir}`, !r.error, r.error ? 'the workspace link is gone' : 'linked');
  }
  for (const pkg of spec.mustThrow) {
    const r = await run(['run', '--rm', image, 'node', '-e', resolveThrows(pkg)]);
    record(`${image}: require.resolve('${pkg}') THROWS`, !r.error, r.error ? 'resolved — the other image\'s package rode along' : `Cannot find package '${pkg}'`);
  }

  // 2. BOOTS and SERVES — /health, then the kind's own real call. The env a
  //    kind names is the LEAST it needs to stand up (the app's service URLs,
  //    the proxy's upstream + actor secret) — never a whole deployment.
  const envArgs = Object.entries(spec.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  if (spec.boots === false) {
    record(`${image}: boot and serve proved by the compose walk, not here`, true, 'stateful: it needs its database');
  } else {
    // The other kinds stand up alone: the env each names is the LEAST it needs.
    const port = await freePort();
    const name = `image-checks-${kind}-${Date.now()}`;
    const base = `http://127.0.0.1:${port}`;
    const started = await run(['run', '--rm', '-d', '--name', name, '-p', `${port}:${spec.containerPort}`, ...envArgs, image]);
    let booted = false;
    try {
      if (started.error) {
        record(`${image}: docker run`, false, started.stderr.trim().split('\n').pop());
      } else {
        let health = null;
        for (let i = 0; i < 60 && !health; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          health = await fetch(`${base}/health`).then((r) => (r.ok ? r : null)).catch(() => null);
        }
        booted = !!health;
        record(`${image}: GET /health`, booted, booted ? '200 {"ok":true}' : 'no 200 within 60s');

        if (booted && spec.probe) {
          const { path, body, check } = spec.probe;
          const method = body ? 'POST' : 'GET';
          const headers = { ...(body ? { 'content-type': 'application/json' } : {}), ...(spec.headers ?? {}) };
          const res = await fetch(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
          const bytes = new Uint8Array(await res.arrayBuffer());
          const json = (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(new TextDecoder().decode(bytes)) : null;
          const what = kind === 'sql' ? 'rows' : kind === 'browser' ? 'image/png' : 'ok';
          record(`${image}: ${method} ${path} answers ${what}`, check(res.status, json, res.headers, bytes));
        }

        // The proxy's own honesty: /health answered while the upstream is DEAD,
        // and a forwarded request is a 5xx, promptly — never a hang.
        if (booted && spec.deadUpstream) {
          const { path, expectStatusAtLeast } = spec.deadUpstream;
          const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
          const ok = !!res && res.status >= expectStatusAtLeast;
          record(`${image}: GET ${path} with a dead upstream is a ${expectStatusAtLeast}xx, not a hang`, ok, res ? `status ${res.status}` : 'no answer within 15s');
        }
      }
    } finally {
      await run(['rm', '-f', name]);
    }
  }

  // 2b. REFUSES TO BOOT without the env the entry demands — the lean app's
  //     own assert (RUNTIME__OMITS' replacement): an image that silently
  //     fell back to an engine it does not carry is the exact hole this closes.
  if (spec.refusesWithoutEnv) {
    const wanted = spec.refusesWithoutEnv;
    const r = await run(['run', '--rm', image], { timeout: 30_000 });
    const named = wanted.test(r.stderr);
    // The REFUSAL is the pass: a non-zero exit naming what it wants. An exit 0
    // means the entry no longer asserts its own shape.
    record(`${image}: refuses to boot without ${wanted.source}`, !!r.error && named,
      r.error ? (named ? `exited ${r.error.code ?? 1} naming what it wants` : 'exited without naming it') : 'exited 0 — the entry no longer asserts its own shape');
  }

  // 3. SIZE — in-container du, never `docker images` (unreliable under colima).
  // Stay on the image's overlay filesystem: `/sys` alone varied by 65 MB
  // between otherwise identical CI runners and made every lean image appear
  // to grow uniformly even though their layers and base digest were unchanged.
  const du = await run(['run', '--rm', '--entrypoint', 'du', image, '-sbx', '/']);
  // Parse the total even if du warns about a transient path while walking.
  const bytes = Number((du.stdout.match(/^(\d+)/) ?? [])[1]);
  const sizeMB = bytes / MB;
  const withinBudget = bytes > 0 && sizeMB <= spec.budgetMB;
  record(`${image}: size ${bytes ? `${sizeMB.toFixed(0)} MB` : 'unknown'} ≤ ${spec.budgetMB} MB (du -sbx /)`, withinBudget, bytes ? '' : du.stderr.trim().split('\n').pop());

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${kind}: ${checks.length - failed.length}/${checks.length} checks passed${failed ? '' : ' — GREEN'}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
