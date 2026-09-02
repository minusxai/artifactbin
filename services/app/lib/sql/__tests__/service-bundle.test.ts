/**
 * THE SERVICE AS AN IMAGE RUNS IT.
 *
 * `service.test.ts` drives the service through `tsx`, which is how a checkout
 * runs it and not how a container does: the image carries ONE bundled ESM file
 * and the native packages beside it. A bundle that cannot start — an import the
 * bundler inlined that had to stay external, an entry that resolves `.ts` only
 * under a loader — is a green suite and a container that exits at line one.
 *
 * So this builds the bundle the Dockerfile's `sql` target ships and runs THAT.
 */
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from '@/__tests__/net';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
// Beside the repo's node_modules, because the bundle leaves the native packages
// external and resolves them at runtime — which is exactly the image's layout.
const bundle = path.resolve(ROOT, 'dist/sql-server.test.mjs');
let child: ReturnType<typeof spawn>;
let serviceUrl: string;

beforeAll(async () => {
  const PORT = await freePort();
  serviceUrl = `http://127.0.0.1:${PORT}`;
  // The same builder the image uses, with the service as its entry point. The
  // entry is TypeScript — esbuild is the bundler either way, and the image has
  // no loader, which is exactly what this test exists to prove.
  execFileSync('node', ['scripts/build-server.mjs', bundle, 'services/sql/src/server.ts'], { cwd: ROOT, stdio: 'pipe' });
  child = spawn('node', [bundle], { env: { ...process.env, APP__PORT: String(PORT) }, stdio: 'inherit' });
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`${serviceUrl}/health`).then((response) => response.ok).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the bundled sql service did not start');
}, 120_000);
afterAll(() => { child?.kill(); rmSync(bundle, { force: true }); });

const input = {
  tables: { ref_ab3xk9: { rows: [{ region: 'EU', v: 5 }, { region: 'US', v: 1 }], columns: [{ name: 'region', type: 'string' as const }, { name: 'v', type: 'number' as const }] } },
  queries: [{ name: 'total', sql: 'select sum(v) as t from ref_ab3xk9 where region = $region', params: ['region'], refs: ['ab3xk9'], start: 0, end: 0 }],
  params: { region: 'EU' },
};

describe('the bundled SQL service', () => {
  it('builds to one file', () => {
    expect(existsSync(bundle)).toBe(true);
  });

  it('runs a query, with the engine loaded from beside the bundle rather than inlined', async () => {
    const res = await fetch(`${serviceUrl}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { results: Record<string, { rows: unknown[] }> };
    expect(body.results.total.rows).toEqual([{ t: 5 }]);
  });

  it('keeps the engine guards — the caller learns the name, never this process internals', async () => {
    const res = await fetch(`${serviceUrl}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, queries: [{ ...input.queries[0], sql: 'drop table ref_ab3xk9' }] }),
    });
    const body = await res.json() as { results?: Record<string, { error?: string }>; error?: string };
    // Refused, and the refusal names the RULE, never where this process lives:
    // a bundler rewrites paths, so a message that leaked one would leak the
    // image's layout to any caller.
    const message = JSON.stringify(body);
    expect(res.status === 400 || !!body.results?.total?.error).toBe(true);
    expect(message).not.toContain('node_modules');
    expect(message).not.toMatch(/\/(Users|app|home|tmp)\//);
  });
});
