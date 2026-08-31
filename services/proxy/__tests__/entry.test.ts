/**
 * P3b-D SEED — RED at handoff. The proxy boots alone: its own config read, its
 * own /health, a lean image that asserts its shape. Layout + composition facts;
 * the only server here is in-process.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PKG = path.resolve(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(PKG, p), 'utf8');

describe('the proxy boots alone (P3b-D seed)', () => {
  it('1. has an entry and a config module, and the entry knows no engine', () => {
    const main = read('src/main.ts');
    expect(fs.existsSync(path.join(PKG, 'src/config.ts'))).toBe(true);
    expect(main).not.toMatch(/@artifactbin\/(sql|browser)/);
    expect(main).not.toMatch(/from ['"]@\//);
  });

  it('2. requires the upstream and the actor secret, defaults the port, audits typos', async () => {
    const { loadConfig } = await import('../src/config');
    const base = { APP__UPSTREAM_URL: 'http://artifactbin-app:3000', CONTRACT__ACTOR_SECRET: 's'.repeat(32) };
    expect(loadConfig(base).port).toBe(3000);
    expect(() => loadConfig({ CONTRACT__ACTOR_SECRET: 'x'.repeat(32) })).toThrow('APP__UPSTREAM_URL');
    expect(() => loadConfig({ APP__UPSTREAM_URL: 'http://a:1' })).toThrow('CONTRACT__ACTOR_SECRET');
    expect(loadConfig({ ...base, APP__UPSTRAEM_URL: 'typo' }).unknownNames).toEqual(['APP__UPSTRAEM_URL']);
  });

  it('3. answers /health itself — the upstream never sees it', async () => {
    const { loadConfig } = await import('../src/config');
    const { createStandaloneProxy } = await import('../src/main');
    const seen: string[] = [];
    const proxy = createStandaloneProxy(
      loadConfig({ APP__UPSTREAM_URL: 'http://artifactbin-app:3000', CONTRACT__ACTOR_SECRET: 's'.repeat(32) }),
      { upstream: async (request) => { seen.push(new URL(request.url).pathname); return Response.json({ from: 'upstream' }); } },
    );
    const res = await proxy.request('http://proxy/health');
    expect(res.status).toBe(200);
    expect(seen).toEqual([]);
  });

  it('4. ships a lean image that asserts its own shape', () => {
    const df = read('Dockerfile');
    expect(df).toMatch(/-w services\/proxy/);
    for (const a of ['test -d node_modules/better-auth', 'test ! -e node_modules/@duckdb', 'test ! -e node_modules/playwright']) {
      expect(df, a).toContain(a);
    }
    expect(df).toMatch(/^HEALTHCHECK/m);
  });
});
