/**
 * THE RATE-LIMIT ENGINE — pure. A validated `PolicyFile` in, a `Decision` out; no HTTP, no filesystem, no
 * yaml (the proxy owns the file and its parser, so the app's closure never grows a parser it does not use).
 *
 * `check()` answers a WHOLE request rather than one budget, because the semantics the file describes —
 * `always` first, then the matched route's policies, ALL of which must allow, EVERY one counted in written
 * order, the FIRST refusal reported — is exactly the complexity a `limit(oneDoor, id)` would push back out
 * into the proxy. That is where it used to live, as `doorFor`.
 */
import type {
  Decision, Identity, LimiterBackend, Policy, PolicyFile, PolicyKey, RateLimiter, Route,
} from '@artifactbin/contracts/rate-limits';
import { POLICY_KEYS } from '@artifactbin/contracts/rate-limits';

const UNITS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600 };

/**
 * `30s` · `1m` · `15m` · `1h` · a plain number of seconds → seconds. Anything else is a refusal naming
 * `at` (the file and the path to the offending value), never a silent default.
 */
export function windowSeconds(raw: unknown, at: string): number {
  const refuse = (): never => {
    throw new Error(`${at}: window ${JSON.stringify(raw)} is not <n>[s|m|h] or a number of seconds`);
  };
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : refuse();
  if (typeof raw !== 'string') return refuse();
  const match = /^(\d+)([smh]?)$/.exec(raw.trim());
  if (!match) return refuse();
  return Number(match[1]) * (match[2] ? UNITS[match[2]]! : 1);
}

const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A count knob (`max`, `burst`, `repeat`): absent falls back, present must be a non-negative finite number. */
function count(raw: unknown, at: string, knob: string, fallback: number | null): number {
  if (raw === undefined || raw === null) {
    if (fallback === null) throw new Error(`${at}: ${knob} must be a non-negative number, got nothing`);
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${at}: ${knob} must be a non-negative number, got ${JSON.stringify(raw)}`);
  return n;
}

/**
 * AN ALREADY-PARSED DOCUMENT → A POLICY FILE, or a refusal that names the offending line. Separate from the
 * yaml read on purpose: the proxy parses, this validates, and a test can hand it a literal.
 *
 * REFUSES (never a silent fallback): a document that is not a mapping · a policy whose `max` is missing,
 * negative or not a number · an unknown `key` · a `window` that does not parse · a route with no `path` ·
 * a `path` that is not a valid regex · a route with no policies · an unknown policy name in a route or in
 * `always`.
 */
export function validatePolicyFile(doc: unknown, source: string): PolicyFile {
  if (!isMapping(doc)) throw new Error(`${source}: empty or not a mapping`);
  if (!isMapping(doc.policies)) throw new Error(`${source}: policies must be a mapping of name → budget`);

  const policies: Record<string, Policy> = {};
  for (const [name, raw] of Object.entries(doc.policies)) {
    const at = `${source}: policies.${name}`;
    if (!isMapping(raw)) throw new Error(`${at}: must be a mapping of max/window/key`);
    const key = (raw.key ?? 'ip') as PolicyKey;
    if (!POLICY_KEYS.includes(key)) throw new Error(`${at}: key must be one of ${POLICY_KEYS.join('|')}, got ${JSON.stringify(raw.key)}`);
    policies[name] = {
      max: count(raw.max, at, 'max', null),
      windowSeconds: windowSeconds(raw.window, at),
      burst: Math.max(1, count(raw.burst, at, 'burst', 1)),
      key,
      repeat: Math.max(1, count(raw.repeat, at, 'repeat', 1)),
    };
  }

  const known = (name: unknown, at: string): string => {
    if (typeof name !== 'string' || !(name in policies)) throw new Error(`${at}: unknown policy ${JSON.stringify(name)}`);
    return name;
  };

  const rawRoutes = doc.routes ?? [];
  if (!Array.isArray(rawRoutes)) throw new Error(`${source}: routes must be a list`);
  const routes: Route[] = rawRoutes.map((raw, i) => {
    const at = `${source}: routes[${i}]`;
    if (!isMapping(raw)) throw new Error(`${at}: must be a mapping`);
    if (typeof raw.path !== 'string' || raw.path === '') throw new Error(`${at}: needs a path (a regex over the pathname)`);
    let pattern: RegExp;
    try { pattern = new RegExp(raw.path); } catch (error) {
      throw new Error(`${at}: path ${JSON.stringify(raw.path)} is not a valid regex — ${(error as Error).message}`);
    }
    const method = raw.method === undefined || raw.method === null
      ? undefined
      : (Array.isArray(raw.method) ? raw.method : [raw.method]).map((m) => String(m).toUpperCase());
    if (method && method.length === 0) throw new Error(`${at}: method must be one method or a list of methods`);
    if (raw.query !== undefined && !isMapping(raw.query)) throw new Error(`${at}: query must be a mapping of search param → exact value`);
    const query = raw.query ? Object.fromEntries(Object.entries(raw.query).map(([k, v]) => [k, String(v)])) : undefined;
    const list = Array.isArray(raw.policies) ? raw.policies : [];
    if (list.length === 0) throw new Error(`${at}: needs at least one policy`);
    return {
      ...(method ? { method } : {}),
      path: raw.path,
      pattern,
      ...(query ? { query } : {}),
      policies: list.map((name) => known(name, at)),
      browserOnly: raw.browser_only === true,
    };
  });

  const rawAlways = doc.always ?? [];
  if (!Array.isArray(rawAlways)) throw new Error(`${source}: always must be a list of policy names`);
  const always = rawAlways.map((name) => known(name, `${source}: always`));

  return { policies, routes, always };
}

/**
 * WHICH ROUTE, if any — FIRST MATCH WINS. `method` absent matches every method; `path` is tested against the
 * PATHNAME; `query` must match exactly on each named search param. A request matching no route is metered by
 * `always` alone, and this answers `null`.
 */
export function routeFor(file: PolicyFile, method: string, url: string): Route | null {
  const parsed = new URL(url);
  const verb = method.toUpperCase();
  for (const route of file.routes) {
    if (route.method && !route.method.includes(verb)) continue;
    if (!route.pattern.test(parsed.pathname)) continue;
    if (route.query && !Object.entries(route.query).every(([k, v]) => parsed.searchParams.get(k) === v)) continue;
    return route;
  }
  return null;
}

/** One hit inside a bucket's window: when it landed, what it cost, and (for `repeat`) what it was a hit ON. */
interface Hit { at: number; weight: number; url?: string }

/**
 * THE SINGLE-PROCESS BACKEND, now WEIGHTED. Hits are `{at, weight, url}` pruned on the way through; a hit
 * whose URL was already seen in this bucket's window costs `1/repeat`. The window's own pruning is what
 * bounds the memory of "which URLs were seen" — there is no second map beside it to grow.
 *
 * A denied attempt is NOT recorded, so refusing a stranger never erodes a holder's room; `count` is the
 * weight already in the window BEFORE this hit, so the caller's verdict is `count < max` exactly as it was
 * when every hit cost 1.
 *
 * PER PROCESS, unchanged: two proxy replicas each hold their own counters, and the effective ceiling is
 * `max × replicas`. That was true of the doors and is true here.
 */
export function memoryBackend(opts: { maxBuckets?: number } = {}): LimiterBackend & { reset(): void; size(): number } {
  const hits = new Map<string, Hit[]>();
  const buckets = new Set<string>();
  const maxBuckets = Math.max(1, Math.trunc(opts.maxBuckets ?? 10_000));
  const makeRoom = (bucket: string) => {
    if (buckets.has(bucket)) return;
    while (buckets.size >= maxBuckets) {
      const oldest = buckets.values().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest); hits.delete(oldest);
    }
    buckets.add(bucket);
  };
  return {
    async hit(bucket, windowMs, max, now, o = {}) {
      makeRoom(bucket);
      const live = (hits.get(bucket) ?? []).filter((h) => now - h.at < windowMs);
      const spent = live.reduce((sum, h) => sum + h.weight, 0);
      const repeat = Math.max(1, o.repeat ?? 1);
      // The discount needs an identity to repeat ON: with no url every hit is a new one and costs 1.
      const seen = repeat > 1 && o.url !== undefined && live.some((h) => h.url === o.url);
      if (spent < max) live.push({ at: now, weight: seen ? 1 / repeat : 1, ...(o.url !== undefined ? { url: o.url } : {}) });
      hits.set(bucket, live);
      return { count: spent, oldest: live[0]?.at ?? null };
    },
    reset() { hits.clear(); buckets.clear(); },
    size() { return buckets.size; },
  };
}

/** One policy's bucket for an identity — exported for the tests that pin the partitioning. */
export function bucketFor(name: string, policy: Policy, id: Identity): string {
  const actor = id.actorId || null;
  switch (policy.key) {
    case 'ip': return `${name}:ip:${id.ip}`;
    // an actor-keyed policy with no actor keys on the ip: a shared "no actor" bucket would let strangers starve each other
    case 'actor': return actor ? `${name}:actor:${actor}` : `${name}:ip:${id.ip}`;
    case 'ip+actor': return `${name}:ip+actor:${id.ip}|${actor ?? ''}`;
    // an email-keyed policy with no address is a programming error: the caller asks `needsEmail` first.
    case 'email': {
      if (!id.email) throw new Error(`${name}: an email-keyed policy was checked with no address — ask needsEmail() first`);
      return `${name}:email:${id.email}`;
    }
  }
}

/**
 * THE LIMITER. `check` runs `always` then the matched route's policies, in written order, counting each; the
 * verdict is allowed when all allowed, else the FIRST refusal with `door` naming that policy.
 */
export function createRateLimiter(o: { file: PolicyFile; backend: LimiterBackend }): RateLimiter {
  const { file, backend } = o;
  const policy = (name: string): Policy => {
    const found = file.policies[name];
    if (!found) throw new Error(`unknown policy: ${name}`);
    return found;
  };
  /** Every policy this request is metered by, `always` first — and that is the order they are counted in. */
  const namesFor = (request: { method: string; url: string }): readonly string[] => {
    const route = routeFor(file, request.method, request.url);
    return route ? [...file.always, ...route.policies] : file.always;
  };
  const one = async (name: string, id: Identity, now: number): Promise<Decision> => {
    const p = policy(name);
    const max = id.holder ? p.max * p.burst : p.max;
    // A closed policy never reaches the backend, and a credential cannot rescue it (0 × n = 0). The WHOLE
    // window is the wait, as the doors answered it — production's one closed policy is anon_mint, at 3600.
    if (max <= 0) return { allowed: false, retryAfter: p.windowSeconds || 60, door: name };
    const windowMs = p.windowSeconds * 1000;
    const { count, oldest } = await backend.hit(bucketFor(name, p, id), windowMs, max, now, {
      ...(id.url !== undefined ? { url: id.url } : {}),
      repeat: p.repeat,
    });
    if (count < max) return { allowed: true, retryAfter: 0, door: name };
    const retryAfter = oldest === null ? p.windowSeconds : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfter, door: name };
  };
  return {
    file,
    policy,
    browserOnly: (request) => routeFor(file, request.method, request.url)?.browserOnly ?? false,
    needsEmail: (request) => namesFor(request).some((name) => policy(name).key === 'email'),
    async check(request, id, opts = {}) {
      const now = opts.now ?? Date.now();
      let last: Decision = { allowed: true, retryAfter: 0, door: '' };
      for (const name of namesFor(request)) {
        last = await one(name, id, now);
        if (!last.allowed) return last;
      }
      return last;
    },
  };
}
