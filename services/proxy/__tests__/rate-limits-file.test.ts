/**
 * THE POLICY FILE — where it is found, what it refuses, and the one claim the whole change rests on:
 * THE PORT IS A NO-OP. `default_rate_limits.yml` reproduces every (method, path) → (policy, max, window,
 * burst, key) pair the old `doorFor` + `DOORS` produced, and the three shipped files differ ONLY in the
 * anonymous mint's ceiling.
 *
 * Seeded RED by the planner: `services/proxy/src/rate-limits.ts` is a skeleton whose every body throws.
 * The parity `describe` compares against `doorFor`/`DOORS`, which still exist at seed time and are DELETED
 * by M1 — the implementer replaces this block's old side with the frozen table in `PARITY` below (it is
 * written out in full for exactly that reason) and deletes the import.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRateLimiter, memoryBackend, routeFor } from '@artifactbin/utils/rate-limits';
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
  it('all parse, and differ ONLY in the anonymous mint\'s ceiling', () => {
    const loaded = files.map((f) => loadPolicyFile(shipped(f)));
    expect(loaded.map((f) => f.policies.anon_mint!.max)).toEqual([0, 10, 2000]);
    for (const f of loaded) {
      expect(Object.keys(f.policies).sort()).toEqual(loaded[0]!.policies && Object.keys(loaded[0]!.policies).sort());
      expect(f.routes.map((r) => r.path)).toEqual(loaded[0]!.routes.map((r) => r.path));
      expect(f.always, 'nothing is metered globally today — see PLAN §2 R6').toEqual([]);
    }
    const withoutMint = (f: (typeof loaded)[number]) => JSON.stringify({ ...f.policies, anon_mint: null }, (_k, v) => (v instanceof RegExp ? String(v) : v));
    expect(withoutMint(loaded[1]!)).toBe(withoutMint(loaded[0]!));
    expect(withoutMint(loaded[2]!)).toBe(withoutMint(loaded[0]!));
  });
});

/**
 * THE FROZEN PARITY TABLE — every representative request, and the policy the OLD code gave it. Measured in
 * planning by walking both implementations (`.agent/PLAN.md` §2 R3, 33 requests, 0 differences).
 * `—` means no limit at all: `doorFor` returned null and nothing global was applied.
 */
const PARITY: Array<[method: string, url: string, policy: string | null, max: number, windowSeconds: number, burst: number, key: string, browserOnly: boolean]> = [
  ['POST', '/api/tokens/anonymous', 'anon_mint', 0, 3600, 5, 'ip', true],
  ['GET', '/api/tokens/anonymous', 'anon_mint', 0, 3600, 5, 'ip', false],
  ['POST', '/api/start', 'anon_mint', 0, 3600, 5, 'ip', false],
  ['POST', '/api/auth/email-otp/send-verification-otp', 'login_send', 5, 3600, 1, 'email', false],
  ['POST', '/api/auth/sign-in/email', 'login_verify', 60, 900, 1, 'ip', false],
  ['POST', '/api/auth/email-otp/verify-email', 'login_verify', 60, 900, 1, 'ip', false],
  ['GET', '/api/auth/session', null, 0, 0, 0, '', false],
  ['POST', '/oauth/register', 'oauth_register', 30, 60, 1, 'ip', false],
  ['POST', '/oauth/token', 'oauth_token', 30, 60, 1, 'ip', false],
  ['GET', '/oauth/authorize', null, 0, 0, 0, '', false],
  ['POST', '/a/abc123/mutate', 'mutate', 60, 60, 1, 'ip', false],
  ['POST', '/a/abc123/query', 'query', 600, 60, 1, 'ip', false],
  ['POST', '/api/query', 'query', 600, 60, 1, 'ip', false],
  ['GET', '/a/abc123/export', 'export', 30, 60, 1, 'actor', false],
  ['GET', '/a/abc123/export?mode=png', 'export', 30, 60, 1, 'actor', false],
  ['POST', '/a/abc123/edits', 'edit', 600, 60, 1, 'actor', false],
  ['GET', '/a/abc123/edits', 'edit', 600, 60, 1, 'actor', false],
  ['POST', '/api/artifacts', 'publish', 600, 60, 1, 'actor', false],
  ['GET', '/api/artifacts', null, 0, 0, 0, '', false],
  ['PATCH', '/api/artifacts/abc', 'publish', 600, 60, 1, 'actor', false],
  ['DELETE', '/api/my/artifacts/abc', 'publish', 600, 60, 1, 'actor', false],
  ['POST', '/mcp', 'publish', 600, 60, 1, 'actor', false],
  ['GET', '/mcp', null, 0, 0, 0, '', false],
  ['GET', '/', null, 0, 0, 0, '', false],
  ['GET', '/a/abc123', null, 0, 0, 0, '', false],
  ['GET', '/docs', null, 0, 0, 0, '', false],
  ['GET', '/health', null, 0, 0, 0, '', false],
  ['GET', '/assets/app.js', null, 0, 0, 0, '', false],
  ['POST', '/api/tokens', null, 0, 0, 0, '', false],
  ['GET', '/tokens/new', null, 0, 0, 0, '', false],
  ['POST', '/api/artifacts/abc/versions', 'publish', 600, 60, 1, 'actor', false],
];

describe('the port is a NO-OP: default_rate_limits.yml reproduces every old door', () => {
  it('every representative request gets the same policy, the same four numbers and the same browser-only verdict', () => {
    const file = loadPolicyFile(shipped('default_rate_limits.yml'));
    const limiter = createRateLimiter({ file, backend: memoryBackend() });
    const diffs: string[] = [];
    for (const [method, url, policy, max, windowSeconds, burst, key, browserOnly] of PARITY) {
      const hit = routeFor(file, method, `http://localhost:6601${url}`);
      const got = hit ? hit.policies : null;
      if (policy === null) {
        if (got !== null) diffs.push(`${method} ${url}: expected NO limit, got ${got!.join('+')}`);
      } else if (got === null || got.length !== 1 || got[0] !== policy) {
        diffs.push(`${method} ${url}: expected ${policy}, got ${got === null ? '—' : got.join('+')}`);
      } else {
        const p = file.policies[policy]!;
        const spec = `${p.max}/${p.windowSeconds}/${p.burst}/${p.key}`;
        if (spec !== `${max}/${windowSeconds}/${burst}/${key}`) diffs.push(`${method} ${url}: ${policy} is ${spec}, expected ${max}/${windowSeconds}/${burst}/${key}`);
      }
      const isBrowserOnly = limiter.browserOnly({ method, url: `http://localhost:6601${url}` });
      if (isBrowserOnly !== browserOnly) diffs.push(`${method} ${url}: browser_only ${isBrowserOnly}, expected ${browserOnly}`);
    }
    expect(diffs).toEqual([]);
    expect(PARITY).toHaveLength(31);
  });

  it('the vocabulary that `doorFor` never reached is GONE, not transcribed: no global, start_link or events_streams policy', () => {
    const file = loadPolicyFile(shipped('default_rate_limits.yml'));
    expect(Object.keys(file.policies).sort()).toEqual(['anon_mint', 'edit', 'export', 'login_send', 'login_verify', 'mutate', 'oauth_register', 'oauth_token', 'publish', 'query']);
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
  it('the doors\' engine, vocabulary and env are deleted outright', () => {
    for (const gone of ['services/contracts/src/doors.ts', 'services/utils/src/doors.ts', 'services/app/lib/rate-limiter/index.ts', 'services/app/lib/rate-limiter/memory.ts']) {
      expect(existsSync(path.join(ROOT, gone)), `${gone} still exists`).toBe(false);
    }
    expect(readFileSync(path.join(ROOT, 'services/proxy/src/parts.ts'), 'utf8')).not.toMatch(/doorFor|anonMintDoor|DoorName/);
  });
});
