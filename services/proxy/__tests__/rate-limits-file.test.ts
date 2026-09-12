/**
 * THE POLICY FILE — where it is found, what it refuses, the vocabulary it may use, and what the card
 * route's discount actually buys. The three shipped files differ ONLY in the start door's ceiling.
 *
 * The frozen parity table that proved the port off the old `doorFor`/`DOORS` engine was a one-time
 * migration proof against code that no longer exists; it is gone, along with the case asserting those
 * modules were deleted. What replaced the engine is asserted here directly, on the shipped files.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRateLimiter, memoryBackend } from '@artifactbin/utils/rate-limits';
import { DEFAULT_POLICY_FILE, defaultPolicyFilePath, loadPolicyFile, POLICY_FILE_ENV, resolvePolicyFilePath } from '../src/rate-limits';

const ROOT = path.resolve(__dirname, '../../..');
const shipped = (name: string) => path.join(ROOT, 'services/proxy', name);

describe('where the default file is', () => {
  it('names the package-relative path, and finds it by walking up from the module — the ONE rule that holds in the source tree AND in both images', () => {
    expect(DEFAULT_POLICY_FILE).toBe('services/proxy/default_rate_limits.yml');
    const found = defaultPolicyFilePath();
    expect(existsSync(found)).toBe(true);
    expect(found.endsWith(DEFAULT_POLICY_FILE)).toBe(true);
  });
  it('PROXY__RATE_LIMIT_CONFIG_FILE overrides it; unset is the default, not a fallback', () => {
    expect(POLICY_FILE_ENV).toBe('PROXY__RATE_LIMIT_CONFIG_FILE');
    expect(resolvePolicyFilePath({})).toBe(defaultPolicyFilePath());
    expect(resolvePolicyFilePath({ PROXY__RATE_LIMIT_CONFIG_FILE: shipped('dev_rate_limits.yml') })).toBe(shipped('dev_rate_limits.yml'));
  });
  it('a configured path that does not exist is a boot refusal naming it — never a silent fallback to built-in numbers', () => {
    expect(() => loadPolicyFile('/nope/rate_limits.yml')).toThrow(/\/nope\/rate_limits\.yml/);
    expect(() => loadPolicyFile('/nope/rate_limits.yml')).toThrow(/ENOENT|no such file/i);
  });
});

describe('the three shipped files', () => {
  const files = ['default_rate_limits.yml', 'selfhost_rate_limits.yml', 'dev_rate_limits.yml'] as const;
  it('all parse, and differ ONLY in the start door\'s ceiling', () => {
    const loaded = files.map((f) => loadPolicyFile(shipped(f)));
    expect(loaded.map((f) => f.policies.start_doc!.max)).toEqual([0, 10, 2000]);
    for (const f of loaded) {
      expect(Object.keys(f.policies).sort()).toEqual(Object.keys(loaded[0]!.policies).sort());
      expect(f.routes.map((r) => r.path)).toEqual(loaded[0]!.routes.map((r) => r.path));
      expect(f.always, 'nothing is metered globally today — see PLAN §2 R6').toEqual([]);
    }
    // The vocabulary is exactly the doors that exist: no global, start_link or events_streams,
    // and no anonymous mint.
    expect(Object.keys(loaded[0]!.policies).sort()).toEqual(['card', 'edit', 'export', 'login_send', 'login_verify', 'mutate', 'oauth_register', 'oauth_token', 'publish', 'query', 'start_doc']);
    const withoutMint = (f: (typeof loaded)[number]) => JSON.stringify({ ...f.policies, start_doc: null }, (_k, v) => (v instanceof RegExp ? String(v) : v));
    expect(withoutMint(loaded[1]!)).toBe(withoutMint(loaded[0]!));
    expect(withoutMint(loaded[2]!)).toBe(withoutMint(loaded[0]!));
  });
});

/**
 * THE CARD ROUTE (M2) — what `repeat` is FOR, measured on the SHIPPED file rather than on a literal, because
 * the numbers that matter are the ones a deployment actually runs.
 *
 * A CARD IS NOT AN EXPORT, and the ceiling says so. ONE PAGE can carry sixty thumbnails that all load at
 * once for one viewer — a profile, a folder, a shelf — so a card budget at `export`'s 30 would lose every
 * thumbnail past the thirtieth on a page doing nothing wrong. Cards are also CACHED per artifact version, so
 * the second and later fetch of one is not a render at all, and `repeat: 20` is what says so. Hence 600
 * distinct cards a minute where a real render still gets 30.
 */
describe('the card route: a shelf of sixty loads, one card is nearly free, six hundred is the ceiling', () => {
  const file = () => loadPolicyFile(shipped('default_rate_limits.yml'));
  const limiter = () => createRateLimiter({ file: file(), backend: memoryBackend() });
  const ME = { ip: '203.0.113.9', actorId: 'usr_card', holder: true };
  const at = (s: number) => 1_700_000_000_000 + s * 1000;

  it('a shelf of SIXTY distinct cards loads in one go — the page this route exists for', async () => {
    const l = limiter();
    const refused: string[] = [];
    for (let i = 0; i < 60; i++) {
      const url = `http://localhost:6601/a/shelf${i}/export?mode=card&v=1&r=2`;
      const d = await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) });
      if (!d.allowed) refused.push(`thumbnail ${i + 1} refused by ${d.door}`);
    }
    expect(refused, 'a sixty-card profile must not lose a thumbnail').toEqual([]);
  });

  it('600 fetches of ONE card export all pass, and cost about 30 of the 600 — a cached card is not a render', async () => {
    const l = limiter();
    const url = 'http://localhost:6601/a/abc123/export?mode=card&v=1&r=2';
    const refused: string[] = [];
    for (let i = 0; i < 600; i++) {
      const d = await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) });
      if (!d.allowed) refused.push(`fetch ${i + 1} refused by ${d.door}`);
    }
    expect(refused).toEqual([]);
    // …and what those 600 actually SPENT: the first is a render, the other 599 a twentieth each.
    // 1 + 599/20 = 30.95, so the same actor still has ~569 FRESH cards left inside the same minute.
    const card = file().policies.card!;
    const spent = 1 + 599 / card.repeat;
    expect(spent).toBeCloseTo(30.95, 2);
    expect(spent, 'a page re-fetching one card must not eat the shelf budget').toBeLessThan(card.max / 10);
  });

  it('but the 601st DISTINCT card in one minute IS refused — `repeat` discounts a re-fetch, it never removes the ceiling', async () => {
    const l = limiter();
    const card = (n: number) => `http://localhost:6601/a/doc${n}/export?mode=card&v=1&r=2`;
    for (let i = 0; i < 600; i++) {
      const url = card(i);
      expect((await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) })).allowed, `distinct card ${i + 1}`).toBe(true);
    }
    const url = card(600);
    const denied = await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) });
    expect(denied.allowed).toBe(false);
    expect(denied.door).toBe('card');
  });

  it('and the 31st plain export is refused exactly as before — a real render still costs a real render', async () => {
    const l = limiter();
    const plain = (n: number) => `http://localhost:6601/a/doc${n}/export`;
    for (let i = 0; i < 30; i++) {
      const url = plain(i);
      expect((await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) })).allowed, `export ${i + 1}`).toBe(true);
    }
    const url = plain(30);
    const denied = await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) });
    expect(denied.allowed).toBe(false);
    expect(denied.door).toBe('export');
  });

  it('a card and a plain export of the SAME document are separate budgets', async () => {
    const l = limiter();
    const card = 'http://localhost:6601/a/abc123/export?mode=card';
    const plain = 'http://localhost:6601/a/abc123/export';
    expect((await l.check({ method: 'GET', url: card }, { ...ME, url: card })).door).toBe('card');
    expect((await l.check({ method: 'GET', url: plain }, { ...ME, url: plain })).door).toBe('export');
  });
});

describe('every number lives in a file, and nowhere else', () => {
  it('no source file names a RATE_LIMITER__ knob except TRUSTED_PROXY_HOPS', () => {
    const offenders: string[] = [];
    const scan = (rel: string) => {
      const full = path.join(ROOT, rel);
      if (!existsSync(full)) return;
      for (const [i, line] of readFileSync(full, 'utf8').split('\n').entries()) {
        const m = /RATE_LIMITER__([A-Z0-9_]+)/.exec(line);
        if (m && m[1] !== 'TRUSTED_PROXY_HOPS') offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    };
    for (const rel of [
      'services/proxy/src/parts.ts', 'services/proxy/src/config.ts', 'services/utils/src/env.ts',
      'services/app/lib/config.ts', 'vitest.config.ts', 'docker-compose.yml', '.env.example',
      'scripts/gates.mjs', 'evals/config.json', 'infra/env/proxy.env.example', '.github/workflows/ci.yml',
    ]) scan(rel);
    expect(offenders).toEqual([]);
  });
});
