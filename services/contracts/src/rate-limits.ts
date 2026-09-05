/**
 * THE RATE LIMITS, AS A CONTRACT. One engine reading one POLICY FILE — no closed door vocabulary, no
 * `RATE_LIMITER__<DOOR>_MAX`, no path→door map in code. A **policy** is a budget; a **route** says which
 * budgets apply where; `always` applies everywhere first. Everything that used to be a `DoorName` is now a
 * string that the file defines, so ADDING A LIMIT IS EDITING A FILE, never editing this package.
 *
 * The types live here so the proxy (which enforces) and utils (which counts) share them without either
 * importing the other, exactly as the doors' vocabulary did.
 *
 * WHERE THE PIECES LIVE:
 *   contracts  — these types.
 *   utils      — `validatePolicyFile` (an already-parsed document → a PolicyFile, or a refusal naming the
 *                offender), `routeFor` (first match wins), `createRateLimiter`, the weighted memory backend.
 *   proxy      — the yaml dependency, `resolvePolicyFilePath(env)`, `loadPolicyFile(path)`, and the shipped
 *                files (`default_rate_limits.yml`, `selfhost_rate_limits.yml`, `dev_rate_limits.yml`).
 */

/** WHO a budget counts. `actor` falls back to the ip when the caller holds no credential (the old rule). */
export type PolicyKey = 'ip' | 'actor' | 'ip+actor' | 'email';

export const POLICY_KEYS: readonly PolicyKey[] = ['ip', 'actor', 'ip+actor', 'email'];

/** One budget, fully resolved: the file's shorthand (`window: 1h`, absent `burst`) is already expanded. */
export interface Policy {
  /** Hits allowed per window. 0 closes the policy for everyone, holder included. */
  max: number;
  /** The window, in seconds — the file writes `30s` / `1m` / `15m` / `1h` or a plain number of seconds. */
  windowSeconds: number;
  /** Multiplier on `max` for a caller who proved a credential, on the SAME bucket. Default 1. */
  burst: number;
  key: PolicyKey;
  /**
   * A hit whose (bucket, full request URL) was already seen inside the window costs `1/repeat` instead of 1.
   * Default 1 (every hit costs 1). What lets a card export be re-fetched by every reader of one page while
   * still bounding how many DISTINCT documents one actor can render.
   */
  repeat: number;
}

/** One row of the routing table. FIRST MATCH WINS — order in the file is the order tried. */
export interface Route {
  /** Absent = every method. The file writes one (`POST`) or a list. Upper-cased at load. */
  method?: readonly string[];
  /** A regular expression over the PATHNAME, as written in the file (kept for the refusal message). */
  path: string;
  /** `path`, compiled once at load. A pattern that does not compile is a boot refusal. */
  pattern: RegExp;
  /** Exact matches required on named search params (`{ mode: card }`). Absent = the query is not consulted. */
  query?: Readonly<Record<string, string>>;
  /** Every one must allow (AND). Each is counted, in this order; the FIRST refusal is the one reported. */
  policies: readonly string[];
  /**
   * The request must come from a browser context or it is refused BEFORE any counting, with the ladder body
   * the proxy owns. The flag only says WHICH routes carry it; the text stays in OSS code.
   */
  browserOnly: boolean;
}

/** A whole policy file, validated. The only thing the engine is ever constructed from. */
export interface PolicyFile {
  policies: Readonly<Record<string, Policy>>;
  routes: readonly Route[];
  /** Applied to EVERY request, before the matched route's policies. Empty in the shipped default. */
  always: readonly string[];
}

/**
 * WHO IS ASKING, and WHAT they asked for. `url` and `email` are new: `repeat` needs the exact URL, and the
 * `email` key needs the address the login code would go to (the lowercased `email` in the JSON body — the
 * proxy extracts it; absent on a route whose policy keys on `email` is a 400 `email_invalid`, as today).
 */
export interface Identity {
  ip: string;
  actorId?: string | null;
  /** The caller proved a credential: BURST applies, on the same bucket. */
  holder?: boolean;
  /** The full request URL — the `repeat` discount's identity. */
  url?: string;
  /** The lowercased address, for an `email`-keyed policy. */
  email?: string | null;
}

export interface Decision {
  allowed: boolean;
  /** Seconds until the next attempt could succeed (0 when allowed). */
  retryAfter: number;
  /**
   * WHICH POLICY DECIDED — the policy name from the file (`export`, `login_send`, `card`). Named `door` and
   * not `policy` because it is what the 429 body and the `door.denied` event have always carried; the value
   * is a policy name now, and the field is already typed `string` in the events contract.
   */
  door: string;
}

/** What a backend must do: count WEIGHTED hits in a window (and record this one). */
export interface LimiterBackend {
  /**
   * Record a hit of `weight` unless doing so would exceed `max`; answer the weight ALREADY counted in the
   * window (before this hit) and the oldest hit's time. A denied attempt is NOT recorded, so refusing a
   * stranger never erodes a holder's room.
   *
   * `repeat` and `url` together are how the discount is computed INSIDE the backend rather than in a map
   * beside it: the window's own pruning is what bounds the memory of "which URLs were seen".
   */
  hit(
    bucket: string,
    windowMs: number,
    max: number,
    now: number,
    opts?: { url?: string; repeat?: number },
  ): Promise<{ count: number; oldest: number | null }>;
}

/**
 * THE ENGINE'S WHOLE INTERFACE — deep by design: one call answers a whole request, so the proxy part that
 * uses it only translates HTTP into `Identity` and a `Decision` into a response. The route matching, the
 * `always` list, the AND across policies, the counting order and the first-refusal rule are all inside.
 */
export interface RateLimiter {
  /**
   * The verdict for one request: `always` first, then the matched route's policies, each counted in written
   * order. Allowed when every policy allowed; otherwise the FIRST refusal, `door` naming that policy.
   */
  check(request: { method: string; url: string }, id: Identity, opts?: { now?: number }): Promise<Decision>;
  /** Does this request's route demand a browser context? Asked BEFORE `check`, so a refusal costs nothing. */
  browserOnly(request: { method: string; url: string }): boolean;
  /** Does the matched route need an address (any policy keyed `email`)? The proxy reads the body only then. */
  needsEmail(request: { method: string; url: string }): boolean;
  /** One policy's resolved numbers, for tests and for the boot notice. */
  policy(name: string): Policy;
  /** The file this limiter was built from. */
  file: PolicyFile;
}
