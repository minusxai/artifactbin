/**
 * THE RATE-LIMIT ENGINE — pure. A validated `PolicyFile` in, a `Decision` out; no HTTP, no filesystem, no
 * yaml (the proxy owns the file and its parser, so the app's closure never grows a parser it does not use).
 *
 * SKELETON — every body throws `rate-limits: implement …`. The contracts are in
 * `@artifactbin/contracts/rate-limits`; the tests that define done are `__tests__/rate-limits.test.ts`.
 */
import type {
  Identity, Policy, PolicyFile, RateLimiter, Route, LimiterBackend,
} from '@artifactbin/contracts/rate-limits';

/**
 * `30s` · `1m` · `15m` · `1h` · a plain number of seconds → seconds. Anything else is a refusal naming
 * `at` (the file and the path to the offending value), never a silent default.
 */
export function windowSeconds(raw: unknown, at: string): number {
  throw new Error(`rate-limits: implement windowSeconds (${at}, ${String(raw)})`);
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
  throw new Error(`rate-limits: implement validatePolicyFile (${source})`);
}

/**
 * WHICH ROUTE, if any — FIRST MATCH WINS. `method` absent matches every method; `path` is tested against the
 * PATHNAME; `query` must match exactly on each named search param. A request matching no route is metered by
 * `always` alone, and this answers `null`.
 */
export function routeFor(file: PolicyFile, method: string, url: string): Route | null {
  throw new Error('rate-limits: implement routeFor');
}

/**
 * THE SINGLE-PROCESS BACKEND, now WEIGHTED. Hits are `[time, weight]` pruned on the way through; a hit whose
 * URL was already seen in this bucket's window costs `1/repeat`. The window's own pruning is what bounds the
 * memory of "which URLs were seen" — there is no second map to grow.
 *
 * PER PROCESS, unchanged: two proxy replicas each hold their own counters, and the effective ceiling is
 * `max × replicas`. That was true of the doors and is true here.
 */
export function memoryBackend(opts?: { maxBuckets?: number }): LimiterBackend & { reset(): void; size(): number } {
  throw new Error('rate-limits: implement memoryBackend');
}

/**
 * THE LIMITER. `check` runs `always` then the matched route's policies, in written order, counting each; the
 * verdict is allowed when all allowed, else the FIRST refusal with `door` naming that policy.
 *
 * The bucket is `<policy>:<key>:<value>`; an `actor`-keyed policy with no actor keys on the ip (a shared "no
 * actor" bucket would let strangers starve each other), and an `email`-keyed policy with no address is a
 * programming error — the proxy must not reach here without one.
 */
export function createRateLimiter(o: { file: PolicyFile; backend: LimiterBackend }): RateLimiter {
  throw new Error('rate-limits: implement createRateLimiter');
}

/** One policy's bucket for an identity — exported for the tests that pin the partitioning. */
export function bucketFor(name: string, policy: Policy, id: Identity): string {
  throw new Error('rate-limits: implement bucketFor');
}
