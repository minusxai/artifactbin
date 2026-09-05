# PLAN — `rate-limits`: rate limiting becomes a policy file

This worktree (the one holding `.agent/BRIEF.md`), branch `split-rate-limits` off `main`
(744a21a). Port block 6600–6699. Planning only: nothing here implements the engine, and no existing test
was edited or deleted.

**Decision change absorbed** (coordinator, mid-plan): the per-policy env knobs
`RATE_LIMITER__<POLICY>_{MAX,WINDOW,BURST,KEY}` are **removed entirely**. The only rate-limit env names that
survive are `PROXY__RATE_LIMIT_CONFIG_FILE` and `RATE_LIMITER__TRUSTED_PROXY_HOPS`. Every number lives in a
policy file. §2 R5 and §4 are written against that.

---

## §0 Module design (Ousterhout), stated up front

Three modules, one of them deep, and a fourth that shrinks to nothing.

| module | interface | what it hides |
|---|---|---|
| `services/contracts/src/rate-limits.ts` (NEW) | `Policy`, `Route`, `PolicyFile`, `Identity`, `Decision`, `LimiterBackend`, `RateLimiter` | nothing — types only, no runtime, no deps (the package's rule) |
| `services/utils/src/rate-limits.ts` (NEW) | `validatePolicyFile(doc, source)`, `routeFor(file, method, url)`, `createRateLimiter({file, backend})`, `memoryBackend()`, `windowSeconds`, `bucketFor` | **the deep one.** `RateLimiter.check(request, identity)` answers a WHOLE request: route match, `always`, the AND across policies, the counting order, the first-refusal rule, the bucket shapes, the sliding window, the `repeat` discount. Pure — no HTTP, no fs, no yaml. |
| `services/proxy/src/rate-limits.ts` (NEW) | `POLICY_FILE_ENV`, `DEFAULT_POLICY_FILE`, `defaultPolicyFilePath()`, `resolvePolicyFilePath(env)`, `loadPolicyFile(path)` | the yaml dependency, where the default file is found across three different runtime layouts, and the boot refusal |
| `services/proxy/src/parts.ts` `rateLimit` | unchanged `Part` | shrinks: it only translates HTTP → `Identity` and `Decision` → response. `doorFor`, `anonMintDoor` and the `LOGIN_SEND` block inside `loginRoutes` all fold into it. |

**Why the parser is in the proxy and not in utils.** `yaml` is a runtime dependency, and utils sits in the
app's closure as well as the proxy's. Splitting parse (proxy) from validate (utils) keeps the app free of a
parser it never uses, keeps `validatePolicyFile` testable from a literal with no fixture file, and puts the
`yaml` dependency exactly where the brief said to add it (`services/proxy/package.json`). This is a
deviation from the brief's "the loader's signature … in `services/utils/src/rate-limits.ts`" — see §5 C4.

**Why `check()` and not `limit(policy, …)`.** The brief's semantics (ALL policies must allow, every one
counted in written order, the first refusal reported, `always` first) are exactly the complexity a shallow
`limit(oneDoor, id)` would push back out into the proxy part — which is where it lived before, as `doorFor`.
One call in, one `Decision` out.

**Deleted in the same change** (M1): `services/contracts/src/doors.ts`, `services/utils/src/doors.ts`,
`services/app/lib/rate-limiter/{index,memory}.ts`, `doorFor`, `anonMintDoor`, the `LOGIN_SEND` special case
in `loginRoutes`, `doorsEnv`, `doorConfig`, `createLimiter`, `DOORS`, `DoorName`, `DoorKey`, `Lease`,
`Limiter.acquire`, `LimiterBackend.acquire/release`, `app/lib/config.ts`'s `ANON_MINT_MAX`,
`MUTATION_MAX_PER_MINUTE`, `rateLimiterEnv`, `CONSUMED_BY_PREFIX`.

---

## §1 SEAM MAP — every file that names a door, reads a knob, calls the limiter, or tests one

### 1.1 The vocabulary and the engine (both die at M1)

`services/contracts/src/doors.ts` — 66 lines, the whole closed vocabulary:

```
 6  export const DOORS = {
 7    GLOBAL: { max: 600, windowSeconds: 60, burst: 1, key: 'ip' },
 8    ANON_MINT: { max: 0, windowSeconds: 3600, burst: 5, key: 'ip' },
 9    START_LINK: { max: 0, windowSeconds: 3600, burst: 5, key: 'ip' },
11    LOGIN_SEND: { max: 5, windowSeconds: 3600, burst: 1, key: 'actor' },
13    LOGIN_VERIFY: { max: 60, windowSeconds: 900, burst: 1, key: 'ip' },
14    PUBLISH: { max: 600, windowSeconds: 60, burst: 1, key: 'actor' },
15    EDIT: { max: 600, windowSeconds: 60, burst: 1, key: 'actor' },
16    MUTATE: { max: 60, windowSeconds: 60, burst: 1, key: 'ip' },
17    QUERY: { max: 600, windowSeconds: 60, burst: 1, key: 'ip' },
18    EXPORT: { max: 30, windowSeconds: 60, burst: 1, key: 'actor' },
19    EVENTS_STREAMS: { max: 20, windowSeconds: 0, burst: 1, key: 'ip' },
20    OAUTH_REGISTER: { max: 30, windowSeconds: 60, burst: 1, key: 'ip' },
21    OAUTH_TOKEN: { max: 30, windowSeconds: 60, burst: 1, key: 'ip' },
22  } as const satisfies Record<string, DoorConfig>;
24  export type DoorName = keyof typeof DOORS;
25  export type DoorKey = 'ip' | 'actor' | 'ip+actor';
41  export interface Decision { allowed; retryAfter; door: DoorName }
49  export interface Lease extends Decision { release(): Promise<void>; }
56    hit(bucket, windowMs, max, now): Promise<{ count; oldest }>;
57    acquire(bucket, max): Promise<boolean>;
58    release(bucket): Promise<void>;
```

`services/utils/src/doors.ts` — the engine. `memoryBackend()` (28–65), `doorConfig(door, env)` (68–82,
the `RATE_LIMITER__<DOOR>_<KNOB>` reads at :71/:76/:80), `bucketFor` (84–92), `createLimiter` (94–122),
`doorsEnv` (130–135) with the NODE_ENV rule at :133.

`services/utils/src/index.ts:14` — `export { memoryBackend, doorConfig, createLimiter, doorsEnv } from './doors';`
`services/contracts/src/index.ts:9` — `export * from './doors';`

### 1.2 The proxy — the ONE enforcement point

`services/proxy/src/parts.ts`:

```
 84  export function doorFor(method: string, pathname: string): DoorName | null {
 85    if (pathname === '/api/tokens/anonymous' || pathname === '/api/start') return 'ANON_MINT';
 86    if (pathname.startsWith('/api/auth/sign-in') || pathname.startsWith('/api/auth/email-otp/verify')) return 'LOGIN_VERIFY';
 87    if (pathname === '/oauth/register') return 'OAUTH_REGISTER';
 88    if (pathname === '/oauth/token') return 'OAUTH_TOKEN';
 89    if (/^\/a\/[A-Za-z0-9]+\/mutate$/.test(pathname)) return 'MUTATE';
 90    if (/^\/a\/[A-Za-z0-9]+\/query$/.test(pathname) || pathname === '/api/query') return 'QUERY';
 91    if (/^\/a\/[A-Za-z0-9]+\/export$/.test(pathname)) return 'EXPORT';
 92    if (/\/edits$/.test(pathname)) return 'EDIT';
 93    if (method !== 'GET' && method !== 'HEAD' && (pathname.startsWith('/api/artifacts') || pathname.startsWith('/api/my/artifacts') || pathname === '/mcp')) return 'PUBLISH';
 94    return null;
 95  }
116  export function isBrowserContext(headers, origin): boolean       ← UNCHANGED, the flag only routes to it
140  export function anonMintRefusal(origin, agentHeader): Response   ← UNCHANGED, verbatim, stays in OSS code
164  export function anonMintDoor(o): Part                            ← DELETED; `browser_only: true` replaces it
169      if (c.req.method === 'POST' && pathname === '/api/tokens/anonymous') {   ← why the route carries method POST
184  export function trustedHopsOf(env)  → readEnv(env, 'RATE_LIMITER__TRUSTED_PROXY_HOPS')   ← UNCHANGED
206  export function clientIpOf(headers, trustedHops, peer)           ← UNCHANGED
231  const limiters = new WeakMap<ProxyOptions, Limiter>();
234    l = createLimiter({ backend: memoryBackend(), env: doorsEnv(o.env) });   ← becomes createRateLimiter({ file: loadPolicyFile(resolvePolicyFilePath(o.env)), backend: memoryBackend() })
251  export function rateLimit(o): Part                                ← the one enforcement point
255      const door = doorFor(c.req.method, new URL(c.req.url).pathname);
260      const decision = await limiterFor(o).limit(door, { ip, actorId: actor.userId ?? actor.tokenId ?? null, holder: actor.credential !== 'none' });
266        void say(o.events, subjectOf(actor), 'denied', { kind: 'door', id: door }, { door });
267        return denyResponse({ error: 'rate_limited', retryAfter: decision.retryAfter, door });
276  export function loginRoutes(o): Part
281    a.post('/api/auth/email-otp/send-verification-otp', async (c, next) => {
284      if (!email) return c.json({ error: 'email_invalid' }, 400);            ← moves into rateLimit (email key)
286      const decision = await limiterFor(o).limit('LOGIN_SEND', { …, actorId: email });   ← DELETED special case
288–289  say(… 'LOGIN_SEND') / denyResponse({ … door: 'LOGIN_SEND' })
334  return [session(o), anonMintDoor(o), rateLimit(o), loginRoutes(o), oauthRoutes(o), forwardedHeaders(…), forward(…)];
        ← becomes [session, rateLimit, loginRoutes, oauthRoutes, forwardedHeaders, forward]
```

`services/proxy/src/index.ts:15` exports `doorFor` — the export goes.
`services/proxy/src/config.ts:155` — `createEnv(source, { consumedByPrefix: ['RATE_LIMITER__'] })`; the
exemption goes so a stale knob is loud (§2 R9). `:23` and `:80` are the doc-comments that say why.
`services/proxy/src/auth/human.ts:124` — a comment only ("LOGIN RATE LIMITING IS THE DOORS' JOB"); reword.

### 1.3 The app side — a re-export nothing imports, and two dead constants

`services/app/lib/rate-limiter/index.ts` (10 lines) and `memory.ts` (2 lines) re-export the engine.
**MEASURED: nothing imports them.** `grep -rn "from '.*rate-limiter" services scripts evals` → no hits;
the only two mentions of the path anywhere are a comment (`lib/config.ts:112`) and a test asserting a
sibling file is absent (`lib/__tests__/dead-auth-wiring.test.ts:9`). Both files are deleted outright, and
the brief's "shrinks to what the app still needs" measures to **nothing**.

`services/app/lib/config.ts`:
```
 43    ANON_MINT_MAX: 'RATE_LIMITER__ANON_MINT_MAX',        (RETIRED_ENV_NAMES row)
 68    MUTATION_MAX_PER_MINUTE: 'RATE_LIMITER__MUTATE_MAX', (RETIRED_ENV_NAMES row)
 75    TRUSTED_PROXY_HOPS: 'RATE_LIMITER__TRUSTED_PROXY_HOPS',   ← stays
111  const CONSUMED_BY_PREFIX = ['RATE_LIMITER__'];        ← DELETED
113  export function rateLimiterEnv()                      ← DELETED (one caller: mint-ceiling.test.ts)
119–120  the ANON_MINT_MAX / MUTATE_MAX defaults inside it ← DELETED
204  export const ANON_MINT_MAX = Number(env('RATE_LIMITER','ANON_MINT_MAX') ?? (IS_DEV ? '1000' : '0'));  ← DELETED
280  export const MUTATION_MAX_PER_MINUTE = Number(env('RATE_LIMITER','MUTATE_MAX') ?? '60');              ← DELETED
```
**MEASURED: no app production code reads either constant** — the only consumers are `rateLimiterEnv()` and
three test files (§1.6). The `doors-one-place` invariant holds unchanged after the deletion.

### 1.4 The compositions and the images

`server.ts:212` — the single image: `getRequestListener(assemble(proxyParts({ …, env, … })))`, `env =
process.env` (`:46`). `services/proxy/src/main.ts` → `runStandalone(loadProcessConfig())` → `standalone.ts`
→ `proxyParts`. Both reach the file through `ProxyOptions.env` only; **no new option is needed.**

Both Dockerfiles copy the whole `services/` tree, so all three `.yml` files ship with no new COPY:

```
Dockerfile:35                COPY services ./services                 (builder)
Dockerfile:74                COPY services ./services                 (runtime)
Dockerfile:76                COPY --from=builder /app/dist/server.mjs ./server.mjs
services/proxy/Dockerfile:32 COPY services ./services                 (builder)
services/proxy/Dockerfile:72 COPY services ./services                 (runtime)
services/proxy/Dockerfile:74 COPY --from=builder /app/dist/proxy.mjs ./services/proxy/proxy.mjs
```

Those last two lines are §2 R1: the bundle does **not** sit where the source sits, and the brief's
`new URL('../default_rate_limits.yml', import.meta.url)` therefore resolves to nothing in either image.

And the three `.yml` files survive the BUILD CONTEXT — measured against `.dockerignore`, not assumed
(`COPY services ./services` cannot ship what the context filtered out, and a local suite would never notice):

```
$ python3 -c "…fnmatch every pattern against the path and each of its prefixes…"
patterns: ['node_modules', '.next', 'data', '.git', '.env', '*.log', 'test', '__tests__', 'scripts/parity', 'vitest.config.ts']
included services/proxy/default_rate_limits.yml
included services/proxy/selfhost_rate_limits.yml
included services/proxy/dev_rate_limits.yml
included services/proxy/src/rate-limits.ts
```

**TWO ENV REGISTRIES, and only one is audited.** `src/env.ts` keeps a module-level `asked` set that
`readEnv` writes to (`server.ts:239` merges it into the CO-HOSTED audit); `src/config.ts:155`'s `createEnv`
keeps its own, and ONLY that one feeds `ProxyConfig.unknownNames` — the STANDALONE proxy's boot notice.
`PROXY__RATE_LIMIT_CONFIG_FILE` and `RATE_LIMITER__TRUSTED_PROXY_HOPS` must therefore be read EAGERLY in
`loadConfig` (`env('PROXY','RATE_LIMIT_CONFIG_FILE')`, `env('RATE_LIMITER','TRUSTED_PROXY_HOPS')`) or R9's
widened audit calls them unknown on a correctly configured box. `trustedHopsOf(o.env)` in `parts.ts:184`
keeps working off the raw source; `loadConfig` reads the name only to register it. MEASURED in R9.

### 1.5 Every `RATE_LIMITER__*` outside code

```
.env.example:54    RATE_LIMITER__ANON_MINT_MAX=10
.env.example:55    RATE_LIMITER__TRUSTED_PROXY_HOPS=1                      ← the only survivor
.env.example:56    RATE_LIMITER__MUTATE_MAX=60
.env.example:95    # RATE_LIMITER__<DOOR>_{MAX,WINDOW,BURST,KEY}; KEY is ip, actor, or ip+actor.
docker-compose.yml:29   RATE_LIMITER__ANON_MINT_MAX: ${RATE_LIMITER__ANON_MINT_MAX:-10}
docker-compose.yml:33   RATE_LIMITER__TRUSTED_PROXY_HOPS: ${…:-1}          ← survivor
vitest.config.ts:32     RATE_LIMITER__ANON_MINT_MAX: '10',
evals/config.json:5     "RATE_LIMITER__ANON_MINT_MAX": "2000",
evals/__tests__/server.test.ts:20,45
infra/env/proxy.env.example:17  RATE_LIMITER__ANON_MINT_MAX=500          (env_file of the lean proxy)
scripts/gates.mjs:38 (comment), :163  RATE_LIMITER__ANON_MINT_MAX ?? '2000'
.github/workflows/ci.yml:423    -e RATE_LIMITER__ANON_MINT_MAX=500
docs/operations.md:45, :89
CLAUDE.md:242      "THE DOORS LIVE AT THE PROXY … RATE_LIMITER__<DOOR>_{MAX,WINDOW,BURST,KEY} …"
```
`docker-compose.lean*.yml` set **no** `RATE_LIMITER__ANON_MINT_MAX` at all — the lean proxy inherits it from
`infra/env/proxy.env.example` (500) via `env_file`. §4 M1 maps each of these to a file.

**`_KEY` overrides, as the brief asked.** MEASURED: **no production code reads one.** Readers are
`services/proxy/__tests__/doors.test.ts:24` and `:49`, the documentation line `.env.example:95`,
`CLAUDE.md:242`, and `services/app/lib/__tests__/env-namespacing.test.ts:108` (a list literal in an
assertion). Dropping `_KEY` costs nothing outside tests and docs.

### 1.6 Existing tests — what happens to each (NONE edited in this phase)

| file | today | disposition |
|---|---|---|
| `services/proxy/__tests__/doors.test.ts` | the whole door engine (106 lines), incl. `:104` pinning the 13-name `DOORS` list and `:84` the `acquire` lease door | **DELETE.** Replaced test-for-test by `services/utils/__tests__/rate-limits.test.ts` (seeded). The `acquire` case has no replacement — see §5 C2. |
| `services/utils/__tests__/doors.test.ts` | 29 lines, `doorConfig` knobs + burst + bucket eviction | **DELETE.** Bucket eviction and burst are re-pinned in the seeded utils test. |
| `services/app/lib/__tests__/doors-one-place.test.ts` | scrapes `services/proxy/src/parts.ts` from `export function doorFor` for the vocabulary of record | **REWRITE.** The scrape's anchor is deleted. New rule, same invariant: read the POLICY NAMES from `services/proxy/default_rate_limits.yml` and assert `services/app/lib/auth.ts` and the anonymous-mint route make no limiter call at all. The brief's "`doors-one-place` keeps pinning that" is true in spirit, not mechanically. |
| `services/app/__tests__/mint-ceiling.test.ts` | `:21` imports `rateLimiterEnv`, `:29` `doorConfig('ANON_MINT', rateLimiterEnv())` | **REWRITE** to read the ceiling from the policy file the suite points at. |
| `services/app/__tests__/process-socket.test.ts:76–79` | source-text guard: `mint-ceiling.test.ts` must match `/doorConfig\(/` | **REWRITE** (guard the new read). **A hidden red** — nothing about the name suggests it guards a door. |
| `services/app/__tests__/forwarded-for-spoof.test.ts` | `:18` imports `ANON_MINT_MAX`, loops `+1`/`+2` past it | **REWRITE** to the file's `anon_mint.max`. |
| `services/app/lib/__tests__/anon-mint-dev-default.test.ts` | the whole NODE_ENV-dependent default | **DELETE.** The rule it pins is deleted; `npm run dev` points at `dev_rate_limits.yml` instead. |
| `services/app/lib/__tests__/retired-env.test.ts:5` | `GONE = [… 'RATE_LIMITER__BACKEND', …]` | **EDIT**: add the retired per-door names with the pointer "use `PROXY__RATE_LIMIT_CONFIG_FILE`". |
| `services/app/lib/__tests__/env-namespacing.test.ts:34,108` | `RATE_LIMITER__MUTATE_MAX`, `RATE_LIMITER__QUERY_KEY` as consumed-by-prefix examples | **EDIT** (pick another prefix, or drop the case with `CONSUMED_BY_PREFIX`). |
| `services/app/__tests__/{dev-app:81, public-visibility:36}.test.ts` | set the knob in an env literal / `vi.stubEnv` | **EDIT** → point at a policy file. |
| `services/proxy/__tests__/{helpers.ts:70, parts:17-19, events-emit:30,93,121, session:72,94,99, login-routes:47,55,68, oauth:25}` | `env: { RATE_LIMITER__ANON_MINT_MAX: … }` | **EDIT** → `env: { PROXY__RATE_LIMIT_CONFIG_FILE: <fixture> }`. `helpers.ts` should gain a fixture default so most call sites just drop the line. |
| `services/proxy/__tests__/m2-anon-mint-door.test.ts` | the ladder body + browser-context rule; `:19,90,123,140,152` set the knob | **EDIT (env lines only), assertions UNTOUCHED.** The brief says "must keep passing untouched" — impossible once the knob is gone; see §5 C1. |
| `services/utils/__tests__/env.test.ts:11-12` | `consumedByPrefix: ['RATE_LIMITER__']` as the example | **EDIT** (the mechanism stays; the example must be a prefix something still consumes). |
| `evals/__tests__/server.test.ts:20,45` | asserts the eval server env carries the knob | **EDIT** → the file path. |
| `scripts/__tests__/setup-plan.test.mjs` | carries `ENV_EXAMPLE_BASE64` | **REGENERATE** with `.env.example` at M3 (CLAUDE.md's five-edits rule). |
| `services/app/lib/__tests__/lean-closure.test.ts` | pins each package's dependencies | **CHECK at M1**: `yaml` joins `services/proxy`'s deps. Measured `npm ci --dry-run -w services/proxy` clean; the assertion list may still need the name. |
| `services/proxy/__tests__/standalone-seam.test.ts`, `services/app/__tests__/asset-byte-quota.test.ts`, `services/app/lib/__tests__/m2-token-ladder.test.ts`, `no-retired-env-names.test.ts`, `dead-auth-wiring.test.ts` | mention "door"/"doors" in prose only | **UNTOUCHED.** |

---

## §2 RISK REGISTER — every row MEASURED, script and output pasted

Sorted riskiest first; "riskiest" = plan-changing if wrong. Scripts live in `tmp/m/` (gitignored) in this
worktree and are reproducible from it.

### R1 — the default file does not resolve in EITHER image · **MEASURED · the brief is WRONG · MITIGATED**

The brief states `new URL('../default_rate_limits.yml', import.meta.url)` was measured to work "from an
esbuild bundle relative to the bundle's own location". True of the bundle's location — and the bundle's
location in both Dockerfiles is not the source module's.

```
$ cat > services/proxy/src/__probe.ts   # prints the candidate resolutions
$ node scripts/build-server.mjs $SP/dist/probe.mjs services/proxy/src/__probe.ts    # the REAL bundler
$ cp probe.mjs layout/app/services/proxy/proxy.mjs   # the proxy image's layout, Dockerfile:74
$ cp probe.mjs layout/app/server.mjs                 # the single image's layout, Dockerfile:76

=== SOURCE (tsx, repo tree) ===
module   = file://<repo>/services/proxy/src/__probe.ts
B   miss ./default_rate_limits.yml  -> <repo>/services/proxy/src/default_rate_limits.yml
B   HIT  ../default_rate_limits.yml -> <repo>/services/proxy/default_rate_limits.yml
H upward = <repo>/services/proxy/default_rate_limits.yml

=== LAYOUT A: proxy image /app/services/proxy/proxy.mjs ===
module   = file://<image>/app/services/proxy/proxy.mjs
B   HIT  ./default_rate_limits.yml  -> <image>/app/services/proxy/default_rate_limits.yml
B   miss ../default_rate_limits.yml -> <image>/app/services/default_rate_limits.yml
H upward = <image>/app/services/proxy/default_rate_limits.yml

=== LAYOUT B: single image /app/server.mjs ===
module   = file://<image>/app/server.mjs
B   miss ./default_rate_limits.yml  -> <image>/app/default_rate_limits.yml
B   miss ../default_rate_limits.yml -> <image>/default_rate_limits.yml
H upward = <image>/app/services/proxy/default_rate_limits.yml
```

and the brief's exact expression, run first, with the file present at the source location:

```
=== LAYOUT A === resolved = <image>/app/services/default_rate_limits.yml   exists = false
                 yaml/read FAILED = ENOENT: … open '<image>/app/services/default_rate_limits.yml'
=== LAYOUT B === resolved = <image>/default_rate_limits.yml                exists = false
                 yaml/read FAILED = ENOENT: … open '<image>/default_rate_limits.yml'
```

**No single module-relative path hits in all three layouts** (the two images bundle to different depths:
`services/proxy/` and the WORKDIR root). Candidates considered:

| candidate | source | proxy image | single image | Dockerfile edits |
|---|---|---|---|---|
| `../x.yml` (the brief) | HIT | **miss** | **miss** | — |
| `./x.yml` | **miss** | HIT | **miss** | — |
| ordered list `./`, `../` | HIT | HIT | **miss** | — |
| explicit `COPY` beside each bundle | HIT | HIT | HIT | 2 (and prod's own bundle breaks again at a third depth) |
| **walk up for `services/proxy/default_rate_limits.yml`** | **HIT** | **HIT** | **HIT** | **0** |
| a typed literal + a file only when configured | n/a | n/a | n/a | 0, but contradicts "a number lives in a file" |

**MITIGATION (chosen, seeded):** `defaultPolicyFilePath()` walks up from `import.meta.url`'s directory for
`services/proxy/default_rate_limits.yml`. Zero Dockerfile changes — both images already `COPY services
./services`, and `.dockerignore` does not filter the files (measured, §1.4). Not found = a boot refusal
naming the directories tried. Seeded as a skeleton with the table above in its doc-comment, and pinned by
`rate-limits-file.test.ts`.

### R2 — `yaml` in the bundle and in the lean closure · **MEASURED · clean, unlike prod's**

The brief carries prod's finding that bundling `yaml` trips "Dynamic require". OSS's bundler injects
`const require = __mxCreateRequire(import.meta.url)` as a banner, which is exactly what makes such a require
resolve. Measured with the real bundler and the probe above:

```
$ node scripts/build-server.mjs $SP/dist/probe.mjs services/proxy/src/__probe.ts
build-server: services/proxy/src/__probe.ts → …/probe.mjs         (264 KB — yaml is bundled IN)
$ node layout/app/services/proxy/proxy.mjs
yaml parse of a literal = {"policies":{"a":{"max":1,"window":"1m"}}}
```

**`yaml` needs NO entry in `scripts/runtime-externals.mjs`** — it bundles and runs. (Prod's own build is a
separate invocation and keeps its finding; that is M4's row, not this one.)

Lockfile, per CLAUDE.md's merge rule:
```
$ npm install --package-lock-only --no-audit && npm ci --dry-run --no-audit
up to date in 429ms … added 120 packages in 367ms         (no "Missing: … from lock file")
$ node -e "…lockfile['services/proxy'].dependencies"
{"@artifactbin/contracts":"*","@artifactbin/utils":"*","better-auth":"1.7.2","hono":"4.13.5","kysely":"0.28.17","pg":"8.23.0","yaml":"2.9.0"}
$ npm ci --dry-run --omit=dev --legacy-peer-deps --ignore-scripts -w services/proxy
added 24 packages in 506ms                                 (the lean install resolves)
```

### R3 — the port is a NO-OP · **MEASURED · 33 requests, 0 differences**

`tmp/m/parity.ts` walks a corpus through the OLD `doorFor` + `DOORS` (imported from the packages) and a
PROTOTYPE of the new matcher over the file just written. Compared on
`(policy, max, windowSeconds, burst, key-PARTITION, browser_only)`. Bucket-string equality is deliberately
**not** asserted: `LOGIN_SEND` is `key: actor` with the address hand-fed today and `key: email` in the file
— identical partitioning, different spelling.

```
ok   POST   /api/tokens/anonymous      old=ANON_MINT max=0 win=3600 burst=5 key=ip   new=ANON_MINT …  browser_only old=true new=true
ok   POST   /api/auth/email-otp/send-verification-otp  old=LOGIN_SEND max=5 win=3600 burst=1 key=email  new=LOGIN_SEND …
ok   GET    /a/abc123/export?mode=card old=EXPORT max=30 win=60 burst=1 key=actor    new=EXPORT …
ok   POST   /api/artifacts             old=PUBLISH max=600 win=60 burst=1 key=actor  new=PUBLISH …
ok   GET    /api/artifacts             old=—                                          new=—
…
33 requests, 0 differences
doors in DOORS never returned by doorFor: GLOBAL, START_LINK, EVENTS_STREAMS
```

The corpus is frozen into `services/proxy/__tests__/rate-limits-file.test.ts` as `PARITY` (31 rows; the two
`?mode=card` rows move to M2 with the `card` route).

### R4 — `repeat` weighting inside the sliding window · **MEASURED**

```
$ npx tsx tmp/m/repeat.ts
20 hits on the SAME url,      max=20, repeat=20: allowed=20, budget spent = 1.95
20 hits on 20 DISTINCT urls,  max=20, repeat=20: allowed=20, budget spent = 20.00
25 hits on 25 DISTINCT urls,  max=20:            allowed=20 (the 21st is refused)
500 hits on ONE url,          max=20, repeat=20: allowed=380
```

Weighted hits `[time, weight]` in the same pruned list; `count` is the SUM of weights; a hit is recorded
only if `count + weight <= max`. **Design correction to the prototype:** the "have I seen this URL" map must
live INSIDE the backend, keyed with the hit list, so the window's own pruning bounds it — the prototype's
separate `seen` map grows without limit. The contract seeded (`LimiterBackend.hit(bucket, windowMs, max,
now, { url, repeat })`) says so.

### R5 — every env knob now points at a FILE, and gets the same number · **MEASURED**

Three files ship, differing only in the anonymous mint: `default` (0, production), `selfhost` (10),
`dev` (2000).

```
$ node tmp/m/envmap.mjs
ok vitest.config.ts:32         RATE_LIMITER__ANON_MINT_MAX: '10'      -> PROXY__RATE_LIMIT_CONFIG_FILE = …/selfhost_rate_limits.yml   (file says 10)
ok docker-compose.yml:29       …${…:-10}                              -> …${…:-/app/services/proxy/selfhost_rate_limits.yml}          (file says 10)
ok scripts/gates.mjs:163       … ?? '2000'                            -> … ?? …/dev_rate_limits.yml                                    (file says 2000)
ok evals/config.json:5         "…": "2000"                            -> "PROXY__RATE_LIMIT_CONFIG_FILE": "services/proxy/dev_rate_limits.yml"
ok evals/__tests__/server.test.ts:20                                  -> extra: { PROXY__RATE_LIMIT_CONFIG_FILE: dev_rate_limits.yml }
ok .github/workflows/ci.yml:423 -e …=500                              -> -e …=/app/services/proxy/dev_rate_limits.yml   (was 500 — RELAXED numbers COLLAPSE at 2000)
ok infra/env/proxy.env.example:17 …=500                               -> …=/app/services/proxy/dev_rate_limits.yml      (was 500 — same collapse)
ok utils/src/doors.ts:133 (doorsEnv)  NODE_ENV=development ⇒ 1000     -> DELETED; `npm run dev` points at dev_rate_limits.yml (was 1000 — same collapse)
ok app/lib/config.ts:204       ANON_MINT_MAX = env ?? (IS_DEV?1000:0) -> DELETED — the app holds no rate-limit number
ok app/lib/config.ts:280       MUTATION_MAX_PER_MINUTE = env ?? 60    -> DELETED — `mutate` policy, max 60, in every file
ok .env.example:54 / :56                                              -> the file path / removed
ok .env.example:55 · parts.ts:185  RATE_LIMITER__TRUSTED_PROXY_HOPS   -> UNCHANGED — the only surviving RATE_LIMITER__ name
13 sites, 0 unmapped
anon_mint by file: {"default":0,"selfhost":10,"dev":2000}
```

**The one number that changes:** the three "relaxed" ceilings (500 in CI and the lean env file, 1000 in
`doorsEnv`'s dev rule, 2000 in gates and evals) collapse into ONE dev file at 2000. All four mean "a run
cannot exhaust it"; 2000 ≥ all of them. `npm run dev` gets 2000 where it had 1000. No context needs a
fourth file, and no context needs a knob.

### R6 — `always: [ip_flood]` would be a NEW limit, not a port · **MEASURED · OPEN, decided as `always: []`**

`DOORS.GLOBAL` (600/1m/ip) exists in the vocabulary and `doorFor` **never returns it** (measured, R3's last
line). The brief's sample writes `always: [ip_flood]`, which would newly meter every request — including
every asset a browser fetches — at 600/min/ip. That is a behaviour change, not a transcription. The shipped
files carry `always: []` with the reason in a comment, and the seeded test pins it. **Turning it on is a
separate, deliberate decision** (a candidate for M2/M3, with its own measurement of a real page load's
request count).

### R7 — boot REFUSES on every malformed input, naming the offender · **MEASURED**

```
$ npx tsx tmp/m/loader.ts
--- (b) every window and key form ---
  window 30s -> 30s · 1m -> 60s · 15m -> 900s · 1h -> 3600s · "3600" -> 3600s · 60 -> 60s
  key ip / actor / ip+actor / email -> accepted
  burst/repeat defaults -> {"max":1,"windowSeconds":60,"burst":1,"key":"ip","repeat":1}
--- (f) every malformed input REFUSES, naming the offender ---
  refused  unparseable YAML             :: rate_limits.yml: not valid YAML — Flow map in block collection must be sufficiently indented … at line 3, column 1
  refused  unknown policy in a route    :: rate_limits.yml: routes[0]: unknown policy "nope"
  refused  route with no policies       :: rate_limits.yml: routes[0]: needs at least one policy
  refused  regex that does not compile  :: rate_limits.yml: routes[0]: path "^/a/(" is not a valid regex — Invalid regular expression: /^/a/(/: Unterminated group
  refused  unknown key                  :: rate_limits.yml: policies.p: key must be one of ip|actor|ip+actor|email, got "cookie"
  refused  window that does not parse   :: rate_limits.yml: policies.p: window "1fortnight" is not <n>[s|m|h] or a number of seconds
  refused  negative max                 :: rate_limits.yml: policies.p: max must be a non-negative number
  refused  unknown policy in always     :: rate_limits.yml: always: unknown policy "nope"
  refused  empty file                   :: rate_limits.yml: empty or not a mapping
--- a missing PATH is ENOENT, never a silent fallback ---
   ENOENT: no such file or directory, open '/app/nope.yml'
```

### R8 — `browser_only` refuses BEFORE counting, with today's exact body · **MEASURED by inspection + seeded**

`proxyParts` (`parts.ts:334`) puts `anonMintDoor` before `rateLimit` today, "because a refusal must not spend
the per-IP budget its own advice sends the human back to use" (`parts.ts:5–7`). Folding it into `rateLimit`
keeps that only if `browserOnly()` is asked before any `hit()`. The contract makes it a separate call
(`RateLimiter.browserOnly(request)`), and `rate-limits-parts.test.ts` asserts the budget is untouched after a
refusal AND that the body is byte-for-byte today's (`error`, `reason`, 3-rung `ladder`,
`tokens=<base>/tokens/new?source=<agent>`, `docs`). `anonMintRefusal` and `isBrowserContext` are UNCHANGED.

### R9 — a stale per-door env name is LOUD · **MEASURED · the brief's assumption is WRONG · MITIGATED**

The coordinator asked that a leftover `RATE_LIMITER__ANON_MINT_MAX` be reported by the unknown-name audit.
It is **not**, and removing `consumedByPrefix` does not change that:

```
$ npx tsx tmp/m/audit.ts
TODAY  (prefix exempt)                             unknown = ["PROXY__RATE_LIMIT_CONFIG_FILE"]
AFTER  (exemption removed, nothing else read)      unknown = ["PROXY__RATE_LIMIT_CONFIG_FILE"]
AFTER  (+ the two survivors read through createEnv) unknown = []
$ node tmp/m/ours.mjs      # utils/src/env.ts:21  OURS = /^[A-Z][A-Z0-9]*__[A-Z0-9_]+$/
not-ours RATE_LIMITER__ANON_MINT_MAX
not-ours RATE_LIMITER__TRUSTED_PROXY_HOPS
OURS     PROXY__RATE_LIMIT_CONFIG_FILE
OURS     APP__PORT
```

The module half of `OURS` is `[A-Z][A-Z0-9]*` — no underscore — so **no `RATE_LIMITER__*` name has ever been
auditable in the proxy.** (The APP's own audit, `services/app/lib/config.ts:100–101`, uses
`k.includes('__') && /^[A-Z][A-Z0-9_]*$/` and DOES match — so the co-hosted server flags it once
`CONSUMED_BY_PREFIX` is emptied; the standalone proxy does not.)

**MITIGATION (M1):** widen `OURS` to `/^[A-Z][A-Z0-9_]*__[A-Z0-9_]+$/`, drop `consumedByPrefix:
['RATE_LIMITER__']` at `config.ts:155`, and read BOTH survivors through `createEnv` — `env('PROXY',
'RATE_LIMIT_CONFIG_FILE')` and `env('RATE_LIMITER','TRUSTED_PROXY_HOPS')` — so they are never "unknown".
`readEnv` is NOT enough: the two registries are distinct (§1.4). Pinned by the seeded `rate-limits-parts.test.ts` ("a stale per-door env name is LOUD"), which
asserts `config.unknownNames === ['RATE_LIMITER__ANON_MINT_MAX','RATE_LIMITER__EXPORT_MAX']`. Widening
`OURS` touches every service's audit — `services/utils/__tests__/env.test.ts` is the guard to re-run.

### R10 — `EVENTS_STREAMS` and the LEASE half of the contract have no home in a policy file · **MEASURED · OPEN, recommended DELETE**

`Limiter.acquire`, `Lease`, `LimiterBackend.acquire/release` and `DOORS.EVENTS_STREAMS` (`windowSeconds: 0`)
are a CONCURRENCY door, and the policy-file design has no concurrency concept. MEASURED: **nothing calls
`acquire` outside the engine and `services/proxy/__tests__/doors.test.ts:84–92`** (`grep -rn "acquire(" services`
→ only `utils/src/doors.ts:51,114,118`, `contracts/src/doors.ts:57,64` and that test). The plan **deletes**
the lease half with the rest, and the seeded contract has no `acquire`. If a stream cap is ever wanted it
comes back as a `concurrency:` policy shape, deliberately. Flag for the orchestrator — this is a brief gap.

### R10b — `retryAfter` on a CLOSED policy · **parity pinned**

`utils/src/doors.ts:107` answers `retryAfter: cfg.windowSeconds || 60` when `max <= 0`, and it reaches the
caller in the 429 body through `denyResponse`. For `anon_mint` that is **3600** — production's one closed
door. A rewrite that answers 0 or 60 there is a silent, observable change, so the seeded utils test asserts
both `3600` and the `|| 60` fallback for a zero-second window.

### R11 — the limiter is PER PROCESS · **unchanged, noted**

`parts.ts:231–236` holds one `memoryBackend()` per `ProxyOptions` in a `WeakMap`. Two proxy replicas each
keep their own counters, so the effective ceiling is `max × replicas`. True of the doors, true after; no
row changes it, and the seeded `memoryBackend` doc-comment says so.

### R12 — the `card` route is a LOOSENING until `repeat` exists · **decided: card ships with M2**

The brief puts the `card` route in the default file at M1 and `repeat` at M2. A `card` policy of
600/1m/actor without `repeat` would *raise* the export ceiling for `?mode=card` from 30/min to 600/min for a
milestone. The shipped files therefore carry **no `card` route**; it lands in M2 together with `repeat`, and
the two `?mode=card` parity rows land with it.

---

## §3 MILESTONES — cut from the register, riskiest first

### M1 — the cutover: the engine, the loader, the three files, the old code deleted
Rows: **R1, R9, R3, R5, R2, R7, R8, R6, R10, R11.** The whole plan turns on R1 and R3; if the default file
cannot be found in an image, or the port is not a no-op, the design changes.

Ends in something runnable:
1. `npm test` green with the seeded 42 tests passing and every disposition in §1.6 applied.
2. `npm run validate` clean.
3. `node scripts/build-server.mjs dist/proxy.mjs services/proxy/src/main.ts` then run the bundle from
   `services/proxy/proxy.mjs` in a copy of the image layout — it boots and reports the default file's path.
4. `npm run dev` on port 6601 + `npm run test:gates -- http://localhost:6601` green (the mint gate is the
   one that proves `dev_rate_limits.yml` is being read).
5. `docker compose -f docker-compose.lean.yml up` and the composition walk (login → publish → open →
   revoke), plus a burst that trips `anon_mint` and shows `{"error":"rate_limited","door":"anon_mint"}`.
   *(This agent starts no containers; M1's implementer does.)*
6. A stale `RATE_LIMITER__ANON_MINT_MAX` on the boot env prints `[env] … is set but nothing reads it`.

### M2 — `repeat`, and the `card` route
Rows: **R4, R12.** Weighted hits in the backend with the URL memory INSIDE the window; the `card` policy and
its two routes added to all three files; the two `?mode=card` parity rows added. Ends with: a burst of 600
fetches of ONE card export passing while 31 DISTINCT card exports are refused, measured against a running
dev server with curl.

### M3 — the documentation and the env surface
Rows: none new; the debt of R5 and R9. `docs/operations.md:45,89`, `CLAUDE.md:242`, `.env.example:54–56,95`
→ `PROXY__RATE_LIMIT_CONFIG_FILE` and the three files. **`.env.example` drags four more edits** (CLAUDE.md's
five-edits rule): `scripts/lib/setup-plan.mjs`'s `ENV_EXAMPLE_BASE64` regenerated, and
`scripts/__tests__/setup-plan.test.mjs` back to green. Ends with `npm test` green and `node scripts/setup.mjs`
producing a working `.env`.

### M4 — PROD (the other repo, `artifactbin-prod` — NOT this phase)
Its own risks, to be measured there, not here:
- **P1** The deploy control plane installs ONLY the compose file on the box, so a bind-mounted policy file
  would not exist. `infra/prod/rate_limits.yml` is baked into the proxy image (`services/proxy/Dockerfile`
  COPY) and `PROXY__RATE_LIMIT_CONFIG_FILE=/app/rate_limits.yml` set in every compose that runs it.
  MEASURE: `docker run … cat` the path in the built image.
- **P2** Prod's esbuild invocation keeps CJS packages external and ships node_modules; the brief measured
  that bundling `yaml` there trips "Dynamic require". Add `yaml` to prod's `--external` list. (OSS does NOT
  need this — R2.) MEASURE: build prod's bundle and run it.
- **P3 (from the decision change) BOX CLEANUP.** `RATE_LIMITER__ANON_MINT_MAX` and
  `RATE_LIMITER__EXPORT_MAX` must be removed from `~/artifactbin-prod/.env.production` at deploy time —
  their numbers move into `infra/prod/rate_limits.yml`. With R9's widened audit they become unknown names,
  and the stack check's "no env-audit warning" leg fails until they are gone. MEASURE: `prod-dry-run.mjs`.
- **P4** The stack check gains a leg: a burst of `mode=card` fetches passes, an export burst is refused.
- **P5** Prod's own bundle sits at a THIRD depth. R1's upward walk finds
  `services/proxy/default_rate_limits.yml` only if prod's image carries that tree; prod sets the env
  explicitly (P1), so the default is never consulted — but the boot must be measured, not assumed.

---

## §4 What was committed in this phase

`faaf3ff` — contracts, the three policy files, skeletons, the RED tests, `yaml` in the proxy's deps and the
regenerated lockfile. See `.agent/REPORT.md` for the red counts and the commands.

---

## §5 Contradictions and gaps in the brief

- **C1** "Its existing tests (`m2-anon-mint-door.test.ts`) must keep passing untouched." Impossible: five of
  its lines set `RATE_LIMITER__ANON_MINT_MAX`, which the decision change removes. The env lines change; every
  assertion stays untouched.
- **C2** The brief is silent on `EVENTS_STREAMS` and the whole lease half of the `Limiter` contract. R10:
  recommended deleted, because nothing calls it.
- **C3** The brief's YAML sample has 6 policies and `always: [ip_flood]`. A true no-op needs 10 policies, 16
  route rows, and `always: []` (R6). `START_LINK` and `GLOBAL` are dead vocabulary and are dropped.
- **C4** The brief puts `loadPolicyFile` in `services/utils/src/rate-limits.ts`. It is in
  `services/proxy/src/rate-limits.ts` instead, so `yaml` stays out of the app's closure (§0).
- **C5** The brief's default-path resolution is measured WRONG for both images (R1).
- **C6** The brief's `yaml`-externals claim is prod's, and does NOT hold for OSS's bundler (R2).
- **C7** The coordinator's "measure that the audit sees it" — it does not, and cannot without widening
  `OURS` (R9).
- **C8** `doorFor`'s `method !== 'GET' && method !== 'HEAD'` is a NEGATION the file spells as the list
  `[POST, PUT, PATCH, DELETE, OPTIONS]`. An exotic verb (TRACE, PROPFIND) that reached `/api/artifacts` was
  metered by `PUBLISH` and now is not. Judged acceptable; a `method_not:` form is the alternative.
- **C9** `_KEY` overrides: no production code reads one (§1.5). Dropping them costs two test lines and two
  documentation lines.
- **C10** CLAUDE.md says "`.agent/` can never be committed" (it is in the repo's `info/exclude`); the brief
  demands `.agent/PLAN.md` and `.agent/REPORT.md` be committed. They are committed with `git add -f` — the
  orchestrator should `git rm --cached .agent/*` before merging to `main`.
