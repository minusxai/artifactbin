/**
 * THE RATE-LIMIT ENGINE — the loader's validation, the matcher, and the limiter's semantics.
 *
 * Seeded RED by the planner: `services/utils/src/rate-limits.ts` is a skeleton whose every body throws
 * `rate-limits: implement …`. These are the tests that define done for milestone M1.
 *
 * What each `describe` pins, and why:
 *  - validatePolicyFile: a malformed file is a BOOT REFUSAL naming the offender, never a silent fallback to
 *    built-in numbers. A limiter that quietly opens because someone fat-fingered a window is the failure
 *    mode this whole change exists to remove.
 *  - routeFor: FIRST MATCH WINS, so order in the file is the truth. Method lists and `query` are how the
 *    old `doorFor`'s branches (`method !== GET`, `?mode=card`) survive as data.
 *  - the limiter: ALL of a route's policies must allow, every one is COUNTED in written order, and the FIRST
 *    refusal is the one reported — because the 429 body and `door.denied` name it.
 */
import { describe, expect, it } from 'vitest';
import type { PolicyFile } from '@artifactbin/contracts/rate-limits';
import { bucketFor, createRateLimiter, memoryBackend, routeFor, validatePolicyFile, windowSeconds } from '@artifactbin/utils/rate-limits';

const IP = '203.0.113.42';
const at = (s: number) => 1_700_000_000_000 + s * 1000;
const url = (p: string) => `http://localhost:6601${p}`;

/** The document a yaml parse would hand the validator — a literal, so this file needs no parser. */
const DOC = {
  policies: {
    ip_flood: { max: 600, window: '1m', key: 'ip' },
    anon_mint: { max: 2, window: '1h', key: 'ip', burst: 3 },
    login_send: { max: 5, window: '1h', key: 'email' },
    export: { max: 30, window: '1m', key: 'actor' },
    card: { max: 20, window: '1m', key: 'actor', repeat: 20 },
    both: { max: 1, window: '1m', key: 'ip+actor' },
  },
  routes: [
    { method: 'POST', path: '^/api/tokens/anonymous$', policies: ['anon_mint'], browser_only: true },
    { path: '^/api/start$', policies: ['anon_mint'] },
    { method: 'POST', path: '^/api/auth/email-otp/send-verification-otp$', policies: ['login_send'] },
    { method: 'GET', path: '^/a/[A-Za-z0-9]+/export$', query: { mode: 'card' }, policies: ['card'] },
    { method: ['GET', 'HEAD'], path: '^/a/[A-Za-z0-9]+/export$', policies: ['export'] },
    { path: '^/both$', policies: ['both'] },
    { path: '^/pair$', policies: ['export', 'card'] },
  ],
  always: ['ip_flood'],
};
const file = (): PolicyFile => validatePolicyFile(DOC, 'test.yml');
const limiter = (f: PolicyFile = file()) => createRateLimiter({ file: f, backend: memoryBackend() });

describe('windowSeconds', () => {
  it('accepts 30s, 1m, 15m, 1h and a plain number of seconds', () => {
    expect([windowSeconds('30s', 'x'), windowSeconds('1m', 'x'), windowSeconds('15m', 'x'), windowSeconds('1h', 'x'), windowSeconds('3600', 'x'), windowSeconds(60, 'x')])
      .toEqual([30, 60, 900, 3600, 3600, 60]);
  });
  it('refuses anything else, naming where it was', () => {
    expect(() => windowSeconds('1fortnight', 'test.yml: policies.p')).toThrow(/test\.yml: policies\.p.*1fortnight/s);
    expect(() => windowSeconds('1fortnight', 'test.yml: policies.p')).not.toThrow(/implement/);
  });
});

describe('validatePolicyFile — a malformed file REFUSES, naming the offender', () => {
  it('expands the shorthand: window to seconds, burst and repeat to 1', () => {
    const f = file();
    expect(f.policies.ip_flood).toEqual({ max: 600, windowSeconds: 60, burst: 1, key: 'ip', repeat: 1 });
    expect(f.policies.anon_mint).toEqual({ max: 0 + 2, windowSeconds: 3600, burst: 3, key: 'ip', repeat: 1 });
    expect(f.policies.card.repeat).toBe(20);
    expect(f.always).toEqual(['ip_flood']);
  });
  it('normalises a route: one method or a list, both upper-cased; the regex compiled once', () => {
    const f = file();
    expect(f.routes[0]!.method).toEqual(['POST']);
    expect(f.routes[4]!.method).toEqual(['GET', 'HEAD']);
    expect(f.routes[1]!.method).toBeUndefined();
    expect(f.routes[0]!.pattern).toBeInstanceOf(RegExp);
    expect(f.routes[0]!.browserOnly).toBe(true);
    expect(f.routes[1]!.browserOnly).toBe(false);
  });
  const bad: Array<[string, unknown, RegExp]> = [
    ['not a mapping', 'hello', /not a mapping|empty/i],
    ['empty document', null, /not a mapping|empty/i],
    ['a policy with no max', { policies: { p: { window: '1m', key: 'ip' } }, routes: [], always: [] }, /policies\.p.*max/s],
    ['a negative max', { policies: { p: { max: -1, window: '1m', key: 'ip' } }, routes: [], always: [] }, /policies\.p.*max/s],
    ['an unknown key', { policies: { p: { max: 1, window: '1m', key: 'cookie' } }, routes: [], always: [] }, /policies\.p.*key.*cookie/s],
    ['a window that does not parse', { policies: { p: { max: 1, window: '1fortnight', key: 'ip' } }, routes: [], always: [] }, /policies\.p.*window/s],
    ['a route with no path', { policies: { p: { max: 1, window: '1m', key: 'ip' } }, routes: [{ policies: ['p'] }], always: [] }, /routes\[0\].*path/s],
    ['a regex that does not compile', { policies: { p: { max: 1, window: '1m', key: 'ip' } }, routes: [{ path: '^/a/(', policies: ['p'] }], always: [] }, /routes\[0\].*regex|routes\[0\].*\^\/a\/\(/s],
    ['a route with no policies', { policies: { p: { max: 1, window: '1m', key: 'ip' } }, routes: [{ path: '^/x$', policies: [] }], always: [] }, /routes\[0\].*polic/s],
    ['an unknown policy in a route', { policies: { p: { max: 1, window: '1m', key: 'ip' } }, routes: [{ path: '^/x$', policies: ['nope'] }], always: [] }, /routes\[0\].*nope/s],
    ['an unknown policy in always', { policies: { p: { max: 1, window: '1m', key: 'ip' } }, routes: [], always: ['nope'] }, /always.*nope/s],
  ];
  for (const [label, doc, message] of bad) {
    it(`refuses ${label}`, () => {
      expect(() => validatePolicyFile(doc, 'rate_limits.yml')).toThrow(message);
      expect(() => validatePolicyFile(doc, 'rate_limits.yml')).toThrow(/rate_limits\.yml/);
    });
  }
});

describe('routeFor — first match wins', () => {
  it('matches on method, path and query, in the file\'s order', () => {
    const f = file();
    expect(routeFor(f, 'POST', url('/api/tokens/anonymous'))?.policies).toEqual(['anon_mint']);
    expect(routeFor(f, 'GET', url('/api/tokens/anonymous'))).toBeNull();
    expect(routeFor(f, 'DELETE', url('/api/start'))?.policies, 'no method = every method').toEqual(['anon_mint']);
    expect(routeFor(f, 'GET', url('/a/abc123/export?mode=card'))?.policies, 'the query row is written first').toEqual(['card']);
    expect(routeFor(f, 'GET', url('/a/abc123/export'))?.policies).toEqual(['export']);
    expect(routeFor(f, 'GET', url('/a/abc123/export?mode=png'))?.policies).toEqual(['export']);
    expect(routeFor(f, 'HEAD', url('/a/abc123/export'))?.policies, 'a method LIST').toEqual(['export']);
  });
  it('answers null for a request no route matches — such a request is metered by `always` alone', () => {
    expect(routeFor(file(), 'GET', url('/docs'))).toBeNull();
  });
});

describe('the limiter', () => {
  it('runs `always` first, then the route\'s policies — a request matching no route is still metered', async () => {
    const l = limiter();
    const d = await l.check({ method: 'GET', url: url('/docs') }, { ip: IP });
    expect(d).toEqual({ allowed: true, retryAfter: 0, door: 'ip_flood' });
  });

  it('ALL of a route\'s policies must allow; every one is COUNTED in written order; the FIRST refusal is named', async () => {
    const l = limiter();
    // `pair` is [export(30), card(20)] — card runs out first, and its name is what comes back.
    for (let i = 0; i < 20; i++) expect((await l.check({ method: 'GET', url: url(`/pair?i=${i}`) }, { ip: IP, actorId: 'usr_a' }, { now: at(i) })).allowed).toBe(true);
    const denied = await l.check({ method: 'GET', url: url('/pair?i=99') }, { ip: IP, actorId: 'usr_a' }, { now: at(21) });
    expect(denied.allowed).toBe(false);
    expect(denied.door).toBe('card');
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it('a refusal by `always` never reaches the route\'s policies — the first refusal wins outright', async () => {
    const tiny = validatePolicyFile({ ...DOC, policies: { ...DOC.policies, ip_flood: { max: 0, window: '1m', key: 'ip' } } }, 'test.yml');
    const l = limiter(tiny);
    const d = await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP });
    expect(d.allowed).toBe(false);
    expect(d.door).toBe('ip_flood');
  });

  it('MAX=0 closes a policy for everyone, holder included', async () => {
    const closed = validatePolicyFile({ ...DOC, policies: { ...DOC.policies, anon_mint: { max: 0, window: '1h', key: 'ip', burst: 5 } } }, 'test.yml');
    const l = limiter(closed);
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP })).allowed).toBe(false);
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP, holder: true })).allowed).toBe(false);
  });

  it('BURST raises the ceiling for a holder on the SAME bucket, and a denied attempt is not counted', async () => {
    const l = limiter();
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP })).allowed).toBe(true);
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP })).allowed).toBe(true);
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP })).allowed, 'the stranger is done at 2').toBe(false);
    for (let i = 0; i < 4; i++) expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP, holder: true })).allowed, `holder ${i + 1} of 4`).toBe(true);
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP, holder: true })).allowed).toBe(false);
  });

  it('an actor-keyed policy with no actor falls back to the ip, never to a shared bucket', async () => {
    const f = file();
    expect(bucketFor('export', f.policies.export!, { ip: IP, actorId: 'usr_a' })).toBe('export:actor:usr_a');
    expect(bucketFor('export', f.policies.export!, { ip: IP })).toBe('export:ip:203.0.113.42');
    expect(bucketFor('both', f.policies.both!, { ip: IP, actorId: 'usr_a' })).toBe('both:ip+actor:203.0.113.42|usr_a');
    const l = limiter();
    expect((await l.check({ method: 'GET', url: url('/a/x/export') }, { ip: IP })).allowed).toBe(true);
    expect((await l.check({ method: 'GET', url: url('/a/x/export') }, { ip: '198.51.100.1' })).allowed).toBe(true);
  });

  it('an email-keyed policy counts the ADDRESS — an office behind one NAT is many people', async () => {
    const l = limiter();
    const send = (email: string, ip = IP) => l.check({ method: 'POST', url: url('/api/auth/email-otp/send-verification-otp') }, { ip, email });
    expect(bucketFor('login_send', file().policies.login_send!, { ip: IP, email: 'a@b.test' })).toBe('login_send:email:a@b.test');
    for (let i = 0; i < 5; i++) expect((await send('a@b.test')).allowed).toBe(true);
    expect((await send('a@b.test')).allowed, 'the sixth to the same address').toBe(false);
    expect((await send('a@b.test', '198.51.100.9')).allowed, 'the same address from another ip shares the bucket').toBe(false);
    expect((await send('other@b.test')).allowed, 'another address on the same ip has its own').toBe(true);
  });

  it('REPEAT: a hit whose exact URL was already seen in the window costs 1/repeat', async () => {
    const same = url('/a/abc123/export?mode=card');
    const l = limiter();
    // card is max 20, repeat 20 — 100 fetches of ONE card stay inside a budget that 20 distinct ones exhaust.
    for (let i = 0; i < 100; i++) {
      expect((await l.check({ method: 'GET', url: same }, { ip: IP, actorId: 'usr_a', url: same }, { now: at(i) })).allowed, `same-url hit ${i + 1}`).toBe(true);
    }
    const l2 = limiter();
    for (let i = 0; i < 20; i++) {
      const u = url(`/a/doc${i}/export?mode=card`);
      expect((await l2.check({ method: 'GET', url: u }, { ip: IP, actorId: 'usr_a', url: u }, { now: at(i) })).allowed, `distinct hit ${i + 1}`).toBe(true);
    }
    const u21 = url('/a/doc20/export?mode=card');
    expect((await l2.check({ method: 'GET', url: u21 }, { ip: IP, actorId: 'usr_a', url: u21 }, { now: at(21) })).allowed, 'the 21st DISTINCT card').toBe(false);
  });

  it('allows MAX hits inside WINDOW, then denies with a retryAfter that lands after the oldest hit expires', async () => {
    const f = validatePolicyFile({ policies: { p: { max: 3, window: '1m', key: 'ip' } }, routes: [{ path: '^/x$', policies: ['p'] }], always: [] }, 'test.yml');
    const l = limiter(f);
    for (let i = 0; i < 3; i++) expect((await l.check({ method: 'GET', url: url('/x') }, { ip: IP }, { now: at(i) })).allowed).toBe(true);
    const d = await l.check({ method: 'GET', url: url('/x') }, { ip: IP }, { now: at(10) });
    expect(d.allowed).toBe(false);
    expect(d.retryAfter).toBe(50); // the first hit (t=0) leaves the window at t=60
    expect((await l.check({ method: 'GET', url: url('/x') }, { ip: IP }, { now: at(61) })).allowed).toBe(true);
  });

  it('browserOnly and needsEmail are asked BEFORE any counting, so a refusal spends no budget', async () => {
    const l = limiter();
    expect(l.browserOnly({ method: 'POST', url: url('/api/tokens/anonymous') })).toBe(true);
    expect(l.browserOnly({ method: 'POST', url: url('/api/start') }), '/api/start is posted by agents with no browser').toBe(false);
    expect(l.needsEmail({ method: 'POST', url: url('/api/auth/email-otp/send-verification-otp') })).toBe(true);
    expect(l.needsEmail({ method: 'POST', url: url('/api/start') })).toBe(false);
    // nothing above counted: the anon_mint budget of 2 is still whole
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP })).allowed).toBe(true);
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP })).allowed).toBe(true);
    expect((await l.check({ method: 'POST', url: url('/api/start') }, { ip: IP })).allowed).toBe(false);
  });

  it('bounds attacker-controlled bucket cardinality and evicts the oldest bucket', async () => {
    const f = validatePolicyFile({ policies: { p: { max: 1, window: '1m', key: 'ip' } }, routes: [{ path: '^/x$', policies: ['p'] }], always: [] }, 'test.yml');
    const backend = memoryBackend({ maxBuckets: 2 });
    const l = createRateLimiter({ file: f, backend });
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) expect((await l.check({ method: 'GET', url: url('/x') }, { ip })).allowed).toBe(true);
    expect((await l.check({ method: 'GET', url: url('/x') }, { ip: '10.0.0.1' })).allowed, 'the oldest bucket was evicted').toBe(true);
    expect(backend.size()).toBeLessThanOrEqual(2);
  });
});
