/**
 * A RATE LIMIT IS ENFORCED IN EXACTLY ONE PLACE (P2 §H).
 *
 * The proxy's policy file decides which budgets a request spends, and its
 * limiter counts them BEFORE the request is forwarded. An app-side helper
 * counting the SAME budget in the same co-hosted process halves the configured
 * ceiling — a live bug this wave found: the anonymous mint, the mutation valve
 * and the publish limit were each counted twice. So the app may make NO
 * limiter call naming a policy the file carries; it keeps only its own QUOTAS
 * (web-ingest, counted per URL inside one publish, which no proxy can see).
 *
 * The VOCABULARY OF RECORD moved with the mechanism: it used to be `doorFor`'s
 * source text, and it is now `services/proxy/default_rate_limits.yml` — read
 * as a file, never imported, because the app tree imports nothing from the
 * proxy package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');

/** Every policy name the shipped default file defines, read from the file itself. */
function policyNames(): string[] {
  const src = fs.readFileSync(path.join(ROOT, 'services/proxy/default_rate_limits.yml'), 'utf8');
  const body = src.slice(src.indexOf('policies:'), src.indexOf('routes:'));
  return [...body.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]!);
}

/** Every limiter call in a file's text — `.limit('x'`, `.check(`, `.hit(` — whatever it names. */
function limiterCalls(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/\.(limit|check|hit)\(\s*'?([A-Za-z_]*)/g)].map((m) => `${m[1]}(${m[2]})`);
}

describe('a rate limit is enforced in exactly one place', () => {
  it('the file names the policies, and the app\'s auth helpers count none of them', () => {
    const policies = policyNames();
    // the vocabulary was READ, not guessed — and it is the one the proxy enforces
    expect(policies).toContain('anon_mint');
    expect(policies.length).toBeGreaterThan(5);
    const authSrc = fs.readFileSync(path.join(ROOT, 'services/app/lib/auth.ts'), 'utf8');
    for (const policy of policies) {
      expect(authSrc, `lib/auth.ts names ${policy}, which the proxy already counts`).not.toMatch(new RegExp(`['"\`]${policy}['"\`]`));
    }
    // Stronger and simpler than the name-by-name rule: after P2 §H the app's
    // auth helpers make no limiter call AT ALL.
    expect(limiterCalls(path.join(ROOT, 'services/app/lib/auth.ts'))).toEqual([]);
  });

  it('the app\'s anonymous mint route carries no limiter call — the proxy counts the anon_mint policy', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services/app/app/api/tokens/anonymous/route.ts'), 'utf8');
    expect(src).not.toMatch(/\.limit\(|\.check\(/);
    expect(src).not.toMatch(/anonMintRateLimited|mutationRateLimited|rateLimited/);
  });

  it('the app holds no rate-limit engine of its own any more', () => {
    for (const gone of ['services/app/lib/rate-limiter/index.ts', 'services/app/lib/rate-limiter/memory.ts']) {
      expect(fs.existsSync(path.join(ROOT, gone)), gone).toBe(false);
    }
  });
});
