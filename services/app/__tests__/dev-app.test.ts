/**
 * `npm run dev:app` — the APP-ONLY dev server: `server.ts --app-only` skips
 * the proxy composition and serves the app's own listener behind the Vite
 * chain, with LOCAL sql/browser registered when no URL names them
 * (`scripts/dev-app.mjs` is the runner that guarantees that last part by
 * neutralising the URLs a worktree's `.env` may carry).
 *
 * Driven as CHILD PROCESSES, the way the gates boot the built bundle: the
 * entry's whole job is to compose a process and bind a port, and no import
 * can test that honestly (its side effects start at boot). The runner is
 * tested through an `npx` PATH SHIM that records the child's argv, cwd and
 * env and exits without booting anything — the runner's whole job is what it
 * spawns, and the shim sees exactly what the spawned server would see.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP_ROOT = path.join(ROOT, 'services', 'app');
const SERVER_TS = path.join(ROOT, 'server.ts');
const DEV_APP = path.join(ROOT, 'scripts', 'dev-app.mjs');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

/** A fetch that fails LOUDLY (status + body) instead of an assertion further out. */
async function fetchChecked(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok && res.status !== 404) {
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

describe('server.ts --app-only', () => {
  let base: string;
  let child: import('node:child_process').ChildProcess;
  let output = '';

  /** Publish the document each local-service assertion consumes, so shuffled tests remain independent. */
  async function publishDocument(): Promise<string> {
    const minted = await fetchChecked(`${base}/api/tokens/anonymous`, { method: 'POST' });
    expect(minted.status).toBe(201);
    const { token } = await minted.json() as { token: string };
    const markup = '<Helmet><Value name="tiny" type="table" value={[{"a":1},{"a":2}]} />'
      + '<Query name="q">{`select sum(a) total from tiny`}</Query></Helmet>'
      + '<Number data="$q" col="total" />';
    const created = await fetchChecked(`${base}/api/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'dev-app boot walk', markup, visibility: 'public' }),
    });
    expect(created.status).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const objects = mkdtempSync(path.join(os.tmpdir(), 'dev-app-objects-'));
    /*
     * The child is its own composition root: no URL names sql or browser
     * (that is the contract dev:app makes on the entry's behalf), the
     * database is throwaway memory, the object store a scratch dir. Names
     * the vitest worker or the machine's `.env` may carry that would point
     * THIS boot somewhere else are deleted, not overridden — an inherited
     * dead URL is exactly the failure dev:app exists to prevent.
     */
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    for (const name of ['SQL__SERVICE_URL', 'BROWSER__SERVICE_URL', 'S3_URL', 'EXPORT__INTERNAL_ORIGIN', 'DATABASE_URL', 'APP__PORT', 'APP__HMR_PORT', 'APP__PUBLIC_BASE_URL', 'OBJECT_STORE__LOCAL_DIR']) delete env[name];
    Object.assign(env, {
      NODE_ENV: 'development',
      APP__PORT: String(port),
      APP__PUBLIC_BASE_URL: base,
      DATABASE_URL: 'pglite://memory',
      OBJECT_STORE__LOCAL_DIR: objects,
      RATE_LIMITER__ANON_MINT_MAX: '10',
      ARTIFACTS__ALLOW_PUBLIC: '1',
      EMAIL__RESEND_API_KEY: 'test-resend-key',
    });

    child = spawn(TSX, [SERVER_TS, '--app-only'], { cwd: APP_ROOT, stdio: ['ignore', 'pipe', 'pipe'], env });
    child.stdout!.on('data', (d: Buffer) => { output += d; });
    child.stderr!.on('data', (d: Buffer) => { output += d; });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}) before answering /health:\n${output}`);
      try {
        const res = await fetch(`${base}/health`);
        if (res.ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server never answered /health:\n${output}`);
  }, 120_000);

  afterAll(() => {
    child?.kill('SIGTERM');
  });

  it('boots the app alone: the log names the app-only boot and the proxy\'s routes are gone', async () => {
    expect(await (await fetchChecked(`${base}/health`)).json()).toEqual({ ok: true });
    expect(output).toMatch(/\[boot\] app-only/);
    // NO proxy is mounted — the double-proxy trap is what dev:app exists to
    // prevent: a proxy in front of a dev app that itself expects a proxy.
    expect((await fetchChecked(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    expect((await fetchChecked(`${base}/oauth/authorize`)).status).toBe(404);
  });

  it('owns the anonymous mint (the app\'s since P2) and the token publishes', async () => {
    expect(await publishDocument()).toBeTruthy();
  });

  it('answers the document\'s query on the LOCAL sql service — no URL names one', async () => {
    const docId = await publishDocument();
    const q = encodeURIComponent(JSON.stringify({ only: ['q'] }));
    const res = await fetchChecked(`${base}/a/${docId}/query?q=${q}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { tables: Record<string, { rows: Array<Record<string, unknown>> }>; errors: Record<string, string> };
    expect(Object.keys(body.errors)).toEqual([]);
    expect(Number(body.tables.q!.rows[0]!.total)).toBe(3); // sum(1,2) — DuckDB in THIS process
    expect((await fetchChecked(`${base}/a/${docId}`)).status).toBe(200);
  }, 60_000);

  it('exports through the LOCAL browser service — no URL names one', async () => {
    const docId = await publishDocument();
    const res = await fetchChecked(`${base}/a/${docId}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes[0]).toBe(0x89); // PNG magic — Chromium really rendered it
  }, 120_000);

  it('serves the SPA through the Vite chain and the docs tree', async () => {
    const page = await fetchChecked(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('/@vite/client'); // transformed by the dev chain, not a stale build
    expect((await fetchChecked(`${base}/llms.txt`)).status).toBe(200);
  }, 120_000);
});

describe('scripts/dev-app.mjs', () => {
  /*
   * The runner is observed from the INSIDE of what it spawns: an `npx` first
   * on PATH records argv, cwd and env, then exits — so the test asserts what
   * the spawned server would actually have seen, not the script's text.
   */
  const shimDir = mkdtempSync(path.join(os.tmpdir(), 'dev-app-shim-'));
  const shimOut = path.join(shimDir, 'spawned.json');
  let res: ReturnType<typeof spawnSync>;
  let spawned: { argv: string[]; cwd: string; env: Record<string, string | null> };

  beforeAll(() => {
    writeFileSync(path.join(shimDir, 'npx'), `#!/usr/bin/env node
const fs = require('node:fs');
const pick = ['SQL__SERVICE_URL', 'BROWSER__SERVICE_URL', 'APP__PORT', 'APP__HMR_PORT', 'NODE_ENV'];
fs.writeFileSync(${JSON.stringify(shimOut)}, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: Object.fromEntries(pick.map((n) => [n, process.env[n] ?? null])),
}, null, 2));
`);
    chmodSync(path.join(shimDir, 'npx'), 0o755);
    res = spawnSync(process.execPath, [DEV_APP], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH}`,
        // The parent environment names the services, as a worktree's .env
        // does — the runner must neutralise them for the child.
        SQL__SERVICE_URL: 'http://127.0.0.1:1',
        BROWSER__SERVICE_URL: 'http://127.0.0.1:2',
        APP__PORT: '5221',
        APP__HMR_PORT: '5222',
        NODE_ENV: 'test',
      },
    });
    spawned = JSON.parse(readFileSync(shimOut, 'utf8'));
  }, 60_000);

  afterAll(() => { rmSync(shimDir, { recursive: true, force: true }); });

  it('spawns `tsx server.ts --app-only` with cwd services/app, the derived ports, and the service URLs unset', () => {
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);
    expect(spawned.argv).toEqual(['tsx', SERVER_TS, '--app-only']);
    expect(spawned.cwd).toBe(APP_ROOT);
    expect(spawned.env.APP__PORT).toBe('5221'); // the derived port reaches the child
    expect(spawned.env.APP__HMR_PORT).toBe('5222');
    expect(spawned.env.NODE_ENV).toBe('development'); // a test harness's NODE_ENV never leaks into the dev server
    // dev:app's contract is LOCAL sql + browser: a URL the environment carried
    // would send every query to a dead service with nothing saying why.
    expect(spawned.env.SQL__SERVICE_URL).toBeNull();
    expect(spawned.env.BROWSER__SERVICE_URL).toBeNull();
  });

  it('prints ONE line when the environment names the service URLs', () => {
    const out = typeof res.stdout === 'string' ? res.stdout : '';
    const lines = out.split('\n').filter((l: string) => /SQL__SERVICE_URL|BROWSER__SERVICE_URL/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/dev:app/);
  });
});
