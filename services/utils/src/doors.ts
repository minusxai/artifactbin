/**
 * THE DOORS' ENGINE — the in-memory limiter, the door-config reader and the doors' environment,
 * moved from packages/proxy/src/doors/{index,memory}.ts and assemble.ts (behaviour unchanged).
 * The vocabulary (DOORS, the door types) lives in @artifactbin/contracts; the proxy enforces the
 * doors, the app's helpers reuse this engine in-process until they retire.
 *
 * A door is a named point of entry. Every door is configured by the same four knobs —
 * `RATE_LIMITER__<DOOR>_MAX`, `_WINDOW` (seconds), `_BURST` (the multiplier a caller who proved a
 * credential gets, on the SAME bucket), and `_KEY` (`ip` | `actor` | `ip+actor`) — so adding a door
 * is adding a name, never a schema. A denied attempt is NOT counted, so refusing a stranger never
 * erodes a holder's room.
 *
 * Pure of HTTP: identity comes in as `{ip, actorId, holder}`; the decision goes out as
 * `{allowed, retryAfter}`. Who extracts the ip (and how many proxy hops to trust) is the caller's
 * business.
 */
import type { DoorConfig, DoorName, DoorKey, Identity, Limiter, LimiterBackend } from '@artifactbin/contracts';
import { DOORS } from '@artifactbin/contracts';

type Env = Record<string, string | undefined>;

const KEYS: readonly DoorKey[] = ['ip', 'actor', 'ip+actor'];

/**
 * The single-process backend: hit timestamps per bucket, pruned on the way
 * through. What every limiter in lib/auth used to be, five times over.
 */
export function memoryBackend(opts: { maxBuckets?: number } = {}): LimiterBackend & { reset(): void; size(): number } {
  const hits = new Map<string, number[]>();
  const leases = new Map<string, number>();
  const buckets = new Set<string>();
  const maxBuckets = Math.max(1, Math.trunc(opts.maxBuckets ?? 10_000));
  const makeRoom = (bucket: string) => {
    if (buckets.has(bucket)) return;
    while (buckets.size >= maxBuckets) {
      const oldest = buckets.values().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest); hits.delete(oldest); leases.delete(oldest);
    }
    buckets.add(bucket);
  };
  return {
    async hit(bucket, windowMs, max, now) {
      makeRoom(bucket);
      const times = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
      const count = times.length;
      if (count < max) times.push(now);
      hits.set(bucket, times);
      return { count, oldest: times[0] ?? null };
    },
    async acquire(bucket, max) {
      makeRoom(bucket);
      const n = leases.get(bucket) ?? 0;
      if (n >= max) return false;
      leases.set(bucket, n + 1);
      return true;
    },
    async release(bucket) {
      const n = leases.get(bucket) ?? 0;
      if (n <= 1) leases.delete(bucket); else leases.set(bucket, n - 1);
    },
    reset() { hits.clear(); leases.clear(); buckets.clear(); },
    size() { return buckets.size; },
  };
}

/** One door's effective configuration: env over defaults, every knob validated. */
export function doorConfig(door: DoorName, env: Env): DoorConfig {
  const base = (DOORS as Record<string, DoorConfig>)[door];
  if (!base) throw new Error(`unknown door: ${String(door)}`);
  const read = (knob: string) => env[`RATE_LIMITER__${door}_${knob}`];
  const num = (knob: string, fallback: number) => {
    const raw = read(knob);
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`RATE_LIMITER__${door}_${knob} must be a non-negative number, got "${raw}"`);
    return n;
  };
  const key = (read('KEY') ?? base.key) as DoorKey;
  if (!KEYS.includes(key)) throw new Error(`RATE_LIMITER__${door}_KEY must be one of ${KEYS.join('|')}, got "${key}"`);
  return { max: num('MAX', base.max), windowSeconds: num('WINDOW', base.windowSeconds), burst: Math.max(1, num('BURST', base.burst)), key };
}

function bucketFor(door: DoorName, cfg: DoorConfig, id: Identity): string {
  const actor = id.actorId || null;
  switch (cfg.key) {
    case 'ip': return `${door}:ip:${id.ip}`;
    // an actor-keyed door with no actor keys on the ip: a shared "no actor" bucket would let strangers starve each other
    case 'actor': return actor ? `${door}:actor:${actor}` : `${door}:ip:${id.ip}`;
    case 'ip+actor': return `${door}:ip+actor:${id.ip}|${actor ?? ''}`;
  }
}

export function createLimiter({ backend, env }: { backend: LimiterBackend; env: Env }): Limiter {
  const configs = new Map<DoorName, DoorConfig>();
  const config = (door: DoorName) => {
    let c = configs.get(door);
    if (!c) { c = doorConfig(door, env); configs.set(door, c); }
    return c;
  };
  return {
    config,
    async limit(door, id, opts = {}) {
      const cfg = config(door);
      const now = opts.now ?? Date.now();
      const max = id.holder ? cfg.max * cfg.burst : cfg.max;
      if (max <= 0) return { allowed: false, retryAfter: cfg.windowSeconds || 60, door };
      const windowMs = cfg.windowSeconds * 1000;
      const { count, oldest } = await backend.hit(bucketFor(door, cfg, id), windowMs, max, now);
      if (count < max) return { allowed: true, retryAfter: 0, door };
      const retryAfter = oldest === null ? cfg.windowSeconds : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      return { allowed: false, retryAfter, door };
    },
    async acquire(door, id) {
      const cfg = config(door);
      const bucket = bucketFor(door, cfg, id);
      const max = id.holder ? cfg.max * cfg.burst : cfg.max;
      const ok = max > 0 && (await backend.acquire(bucket, max));
      return { allowed: ok, retryAfter: ok ? 0 : 1, door, release: async () => { if (ok) await backend.release(bucket); } };
    },
  };
}

/**
 * The doors' environment: every `RATE_LIMITER__*` and the ENVIRONMENT-DEPENDENT default — anonymous
 * minting is closed (0) in production and relaxed (1000) in development so a gate run cannot exhaust
 * it. The app's own config does the same for the helpers it still runs; the two must agree or
 * `npm run dev` closes minting at the proxy while the app believes it open.
 */
export function doorsEnv(env: Env): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith('RATE_LIMITER__')) out[k] = v;
  if (out.RATE_LIMITER__ANON_MINT_MAX === undefined) out.RATE_LIMITER__ANON_MINT_MAX = env.NODE_ENV === 'development' ? '1000' : '0';
  return out;
}
