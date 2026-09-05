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
      expect(Object.keys(f.policies).sort()).toEqual(Object.keys(loaded[0]!.policies).sort());
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
 *
 * THE TWO `?mode=card` ROWS ARE THE ONE DELIBERATE DIFFERENCE (M2). `doorFor` gave them EXPORT, because it
 * could not see a query string at all; the file routes them to `card`, which keeps the SAME ceiling on
 * DISTINCT documents and makes re-fetching ONE of them nearly free. That is the whole point of the route —
 * an unfurl of one page is fetched by every reader who sees the link, and none of them asked for a render.
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
  // M2: the query row sits ABOVE the plain export row, so `?mode=card` never reaches `export`.
  ['GET', '/a/abc123/export?mode=card', 'card', 30, 60, 1, 'actor', false],
  // the real unfurl shape a served document puts in its og:image — extra params must not lose the row
  ['GET', '/a/abc123/export?mode=card&v=1&r=2', 'card', 30, 60, 1, 'actor', false],
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
    expect(PARITY).toHaveLength(33);
  });

  it('the vocabulary that `doorFor` never reached is GONE, not transcribed: no global, start_link or events_streams policy', () => {
    const file = loadPolicyFile(shipped('default_rate_limits.yml'));
    expect(Object.keys(file.policies).sort()).toEqual(['anon_mint', 'card', 'edit', 'export', 'login_send', 'login_verify', 'mutate', 'oauth_register', 'oauth_token', 'publish', 'query']);
  });
});

/**
 * THE CARD ROUTE (M2) — what `repeat` is FOR, measured on the SHIPPED file rather than on a literal, because
 * the numbers that matter are the ones a deployment actually runs. Two claims, and they are in tension:
 * re-fetching ONE card must be nearly free (every reader of a shared link fetches the same unfurl), while
 * the number of DISTINCT documents one actor can have RENDERED must stay exactly where `export` had it.
 */
describe('the card route: one card is nearly free, thirty distinct documents is still the ceiling', () => {
  const file = () => loadPolicyFile(shipped('default_rate_limits.yml'));
  const limiter = () => createRateLimiter({ file: file(), backend: memoryBackend() });
  const ME = { ip: '203.0.113.9', actorId: 'usr_card', holder: true };
  const at = (s: number) => 1_700_000_000_000 + s * 1000;

  it('600 fetches of ONE card export all pass — the readers of one shared link cost one render', async () => {
    const l = limiter();
    const url = 'http://localhost:6601/a/abc123/export?mode=card&v=1&r=2';
    const refused: string[] = [];
    for (let i = 0; i < 600; i++) {
      const d = await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) });
      if (!d.allowed) refused.push(`fetch ${i + 1} refused by ${d.door}`);
    }
    expect(refused).toEqual([]);
  });

  it('but the 31st DISTINCT card is refused — `repeat` discounts a re-fetch, it does not raise the ceiling', async () => {
    const l = limiter();
    const card = (n: number) => `http://localhost:6601/a/doc${n}/export?mode=card&v=1&r=2`;
    for (let i = 0; i < 30; i++) {
      const url = card(i);
      expect((await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) })).allowed, `distinct card ${i + 1}`).toBe(true);
    }
    const url = card(30);
    const denied = await l.check({ method: 'GET', url }, { ...ME, url }, { now: at(0) });
    expect(denied.allowed).toBe(false);
    expect(denied.door).toBe('card');
  });

  it('and 31 plain exports are refused exactly as before — the card route took nothing from `export`', async () => {
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
  it('the doors\' engine, vocabulary and env are deleted outright', () => {
    for (const gone of ['services/contracts/src/doors.ts', 'services/utils/src/doors.ts', 'services/app/lib/rate-limiter/index.ts', 'services/app/lib/rate-limiter/memory.ts']) {
      expect(existsSync(path.join(ROOT, gone)), `${gone} still exists`).toBe(false);
    }
    expect(readFileSync(path.join(ROOT, 'services/proxy/src/parts.ts'), 'utf8')).not.toMatch(/doorFor|anonMintDoor|DoorName/);
  });
});
