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
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from '@artifactbin/test-support/net';
import { stopServer, waitUntilServing } from '../../../scripts/lib/server-process.mjs';

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
  let token: string;
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'dev-app-state-'));

  /** Publish the document each local-service assertion consumes, so shuffled tests remain independent. */
  async function publishDocument(): Promise<string> {
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
    const objects = path.join(scratch, 'objects');
    /*
     * The child is its own composition root: no URL names sql or browser
     * (that is the contract dev:app makes on the entry's behalf), the
     * database is a throwaway directory, the object store a scratch dir. Names
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
      DATABASE_URL: `pglite://${path.join(scratch, 'db')}`,
      OBJECT_STORE__LOCAL_DIR: objects,
      EMAIL__DEV_OUTBOX_PATH: path.join(scratch, 'mail.jsonl'),
      ARTIFACTS__ALLOW_PUBLIC: '1',
      EMAIL__RESEND_API_KEY: 'test-resend-key',
    });

    const launch = (appOnly: boolean): void => {
      output = '';
      child = spawn(TSX, [SERVER_TS, ...(appOnly ? ['--app-only'] : [])], { cwd: APP_ROOT, stdio: ['ignore', 'pipe', 'pipe'], env });
      child.stdout!.on('data', (d: Buffer) => { output += d; });
      child.stderr!.on('data', (d: Buffer) => { output += d; });
    };
    const ready = (): Promise<void> => waitUntilServing(child, {
      url: `${base}/health`, timeoutMs: 90_000, intervalMs: 250,
      exited: (code: number | null) => `server exited (${code}) before answering /health:\n${output}`,
      never: () => `server never answered /health:\n${output}`,
    });

    // App-only has no login routes. Obtain its account bearer through the real
    // composition, then release that process's PGLite handle before reopening
    // the same isolated database in app-only mode.
    launch(false);
    await ready();
    const email = 'mxmx_test_dev_app@example.test';
    const sent = await fetchChecked(`${base}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email, type: 'sign-in' }),
    });
    expect(sent.status).toBe(200);
    const outbox = env.EMAIL__DEV_OUTBOX_PATH!;
    expect(statSync(outbox).mode & 0o777).toBe(0o600);
    const messages = readFileSync(outbox, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { kind: string; to: string; otp?: string; expiresAt?: string });
    const otp = messages.findLast(message => message.kind === 'otp' && message.to === email && Date.parse(message.expiresAt ?? '') > Date.now())?.otp;
    expect(otp).toMatch(/^\d{6}$/);
    const login = await fetchChecked(`${base}/api/auth/sign-in/email-otp`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email, otp }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    expect(cookie).toBeTruthy();
    const pairResponse = await fetchChecked(`${base}/oauth/device`, { method: 'POST' });
    const pair = await pairResponse.json() as { device_code: string; user_code: string };
    expect(pair.device_code).toBeTruthy();
    const approved = await fetchChecked(`${base}/oauth/device/approve`, {
      method: 'POST', headers: { cookie, origin: base }, body: new URLSearchParams({ user_code: pair.user_code }),
    });
    expect(approved.status).toBe(200);
    const exchanged = await fetchChecked(`${base}/oauth/device/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: pair.device_code }),
    });
    expect(exchanged.status).toBe(200);
    token = (await exchanged.json() as { access_token: string }).access_token;
    expect(token).toBeTruthy();
    await stopChild();
    launch(true);
    await ready();
  }, 120_000);

  const stopChild = (): Promise<void> => stopServer(child, { graceMs: 5_000 });

  afterAll(async () => {
    await stopChild();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('boots the app alone: the log names the app-only boot and the proxy\'s routes are gone', async () => {
    expect(await (await fetchChecked(`${base}/health`)).json()).toEqual({ ok: true });
    expect(output).toMatch(/\[boot\] app-only/);
    // NO proxy is mounted — the double-proxy trap is what dev:app exists to
    // prevent: a proxy in front of a dev app that itself expects a proxy.
    expect((await fetchChecked(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    expect((await fetchChecked(`${base}/oauth/authorize`)).status).toBe(404);
  });

  it('refuses logged-out minting and starting while its email-account bearer publishes', async () => {
    const minted = await fetch(`${base}/api/internal/tokens`, { method: 'POST' });
    expect(minted.status).toBe(401);
    expect(await minted.json()).toMatchObject({ error: 'email_auth_required' });
    const started = await fetch(`${base}/api/start`, { method: 'POST' });
    expect(started.status).toBe(401);
    expect(started.headers.getSetCookie()).toEqual([]);
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
    const login = await fetchChecked(`${base}/login`);
    expect(login.status).toBe(200);
    expect(await login.text()).toContain('/solid-entry.tsx');
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
  const manifest = path.join(APP_ROOT, 'public/islands/manifest.json');
  let manifestModified: number;
  let res: ReturnType<typeof spawnSync>;
  let spawned: { argv: string[]; cwd: string; env: Record<string, string | null> };

  beforeAll(() => {
    writeFileSync(path.join(shimDir, 'npx'), `#!${process.execPath}
const fs = require('node:fs');
const pick = ['SQL__SERVICE_URL', 'BROWSER__SERVICE_URL', 'APP__PORT', 'APP__HMR_PORT', 'NODE_ENV', 'PROXY__RATE_LIMIT_CONFIG_FILE'];
fs.writeFileSync(${JSON.stringify(shimOut)}, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: Object.fromEntries(pick.map((n) => [n, process.env[n] ?? null])),
}, null, 2));
`);
    chmodSync(path.join(shimDir, 'npx'), 0o755);
    // Observe the runner's server invocation without rebuilding shared assets
    // underneath other API workers. The suite's global setup owns that build.
    writeFileSync(path.join(shimDir, 'node'), '#!/bin/sh\nexit 0\n');
    chmodSync(path.join(shimDir, 'node'), 0o755);
    manifestModified = statSync(manifest).mtimeMs;
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

  it('leaves the shared test runtime intact', () => {
    expect(statSync(manifest).mtimeMs).toBe(manifestModified);
  });

  it('spawns `tsx server.ts --app-only` with cwd services/app, the derived ports, and the service URLs unset', () => {
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);
    // `tsx watch`, so a server-side change restarts the server; node_modules
    // is excluded (Vite bundles its config there on every boot) and the reader
    // runtime's manifest is included (its rebuild restarts the server too).
    expect(spawned.argv.slice(0, 2)).toEqual(['tsx', 'watch']);
    expect(spawned.argv.slice(-2)).toEqual([SERVER_TS, '--app-only']);
    expect(spawned.argv).toContain('--include');
    expect(spawned.argv).toContain('--exclude');
    expect(spawned.cwd).toBe(APP_ROOT);
    expect(spawned.env.APP__PORT).toBe('5221'); // the derived port reaches the child
    expect(spawned.env.APP__HMR_PORT).toBe('5222');
    expect(spawned.env.NODE_ENV).toBe('development'); // a test harness's NODE_ENV never leaks into the dev server
    // dev:app's contract is LOCAL sql + browser: a URL the environment carried
    // would send every query to a dead service with nothing saying why.
    expect(spawned.env.SQL__SERVICE_URL).toBeNull();
    expect(spawned.env.BROWSER__SERVICE_URL).toBeNull();
  });

  it('does not inject a production request policy into the app child', () => {
    expect(spawned.env.PROXY__RATE_LIMIT_CONFIG_FILE).toBeNull();
  });

  it('prints ONE line when the environment names the service URLs', () => {
    const out = typeof res.stdout === 'string' ? res.stdout : '';
    const lines = out.split('\n').filter((l: string) => /SQL__SERVICE_URL|BROWSER__SERVICE_URL/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/dev:app/);
  });
});
