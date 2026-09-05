# REPORT — planning phase `rate-limits`

Worktree `/Users/ppsreejith/projects/artifact-bin-rate-limits`, branch `split-rate-limits` (base `main`
744a21a). Planning only: the engine is not implemented, no existing test was edited or deleted, no docker
container was started, no browser gate was run, no PR was opened. Ports bound: none.

The plan is `.agent/PLAN.md` — §1 seam map, §2 risk register (12 rows, all MEASURED), §3 milestones, §5 contradictions.

## Commits

| commit | what |
|---|---|
| `faaf3ff` | `rate-limits seed: contracts, the three policy files, skeletons and the RED tests` |
| (this one) | `.agent/PLAN.md` + `.agent/REPORT.md` (committed with `git add -f` — see C10) |

## What was seeded

| file | kind |
|---|---|
| `services/contracts/src/rate-limits.ts` | CONTRACT — `Policy`, `Route`, `PolicyFile`, `Identity` (+`url`,`email`), `Decision.door: string`, weighted `LimiterBackend`, `RateLimiter` |
| `services/contracts/package.json` · `services/utils/package.json` | `./rate-limits` subpath export, so the new types live beside the old doors until M1 deletes them |
| `services/proxy/default_rate_limits.yml` | today's behaviour, transcribed — 10 policies, 16 routes, `always: []` |
| `services/proxy/selfhost_rate_limits.yml` | the same, `anon_mint.max: 10` |
| `services/proxy/dev_rate_limits.yml` | the same, `anon_mint.max: 2000` |
| `services/utils/src/rate-limits.ts` | SKELETON — `windowSeconds`, `validatePolicyFile`, `routeFor`, `memoryBackend`, `createRateLimiter`, `bucketFor`; every body throws `rate-limits: implement …` |
| `services/proxy/src/rate-limits.ts` | SKELETON — `POLICY_FILE_ENV`, `DEFAULT_POLICY_FILE`, `defaultPolicyFilePath`, `resolvePolicyFilePath`, `loadPolicyFile` |
| `services/utils/__tests__/rate-limits.test.ts` | 26 tests — the validator's refusals, the matcher, the limiter's semantics |
| `services/proxy/__tests__/rate-limits-file.test.ts` | 7 tests — where the default file is, the three shipped files, the frozen 31-row PARITY table, "every number lives in a file" |
| `services/proxy/__tests__/rate-limits-parts.test.ts` | 9 tests — the 429 names the policy, `browser_only` before counting with the exact ladder, the email key on ANY route, the loud stale env name |
| `services/proxy/__tests__/fixtures/rate_limits.yml` | test fixture (not a shipped file) |
| `services/proxy/package.json` + `package-lock.json` | `yaml@2.9.0` added to the proxy's dependencies |

## The RED I saw

```
$ npx vitest run --project node services/utils/__tests__/rate-limits.test.ts \
    services/proxy/__tests__/rate-limits-file.test.ts services/proxy/__tests__/rate-limits-parts.test.ts
 Test Files  3 failed (3)
      Tests  42 failed (42)
```

First pass was `38 failed | 4 passed` — four tests were green that had never been red; each was fixed, not kept:

| decorative pass | why it passed | what it now pins |
|---|---|---|
| `windowSeconds > refuses anything else` | the skeleton's own throw contained `at` and the value | `.not.toThrow(/implement/)` |
| `a configured path that does not exist` | the skeleton's throw contained the path | also `.toThrow(/ENOENT/i)` |
| `email_invalid 400` | `loginRoutes` already answers 400 on that one path | the fixture gained `POST /api/email-keyed` with an `email`-keyed policy — a route `loginRoutes` has never heard of. Today: 200. |
| `/api/start is NOT browser-only` | trivially true today | now also asserts the second POST is 429 with `door: "anon_mint"` (today: `ANON_MINT`) |

Whole suite, to prove the seed broke nothing else:

```
$ npm test
 Test Files  3 failed | 299 passed (302)
      Tests  42 failed | 3153 passed | 1 skipped (3196)
$ npm run validate
Residual-name guard passed (7 exact persistence/history rules).
> tsc --noEmit -p ../../tsconfig.json          (clean)
```

The 42 failures are exactly the 42 seeded; the 3 failing files are exactly the 3 seeded.

## What I measured (every §2 row; scripts in `tmp/m/`, gitignored)

1. **R1 — the brief's default-file path is WRONG in both images.** Bundled a probe with the real
   `scripts/build-server.mjs` and ran it from each Dockerfile's layout.
   `new URL('../default_rate_limits.yml', import.meta.url)` from `/app/services/proxy/proxy.mjs` resolves to
   `/app/services/default_rate_limits.yml` (ENOENT), and from `/app/server.mjs` to `/default_rate_limits.yml`
   (ENOENT). No module-relative path hits all three layouts. **Mitigated** by an upward walk for
   `services/proxy/default_rate_limits.yml` — hits in all three, zero Dockerfile changes.
2. **R2 — `yaml` bundles cleanly under OSS's bundler** (the banner's `createRequire` is why); no
   `runtime-externals.mjs` entry needed. `npm ci --dry-run` clean after the lockfile regeneration; the lean
   `-w services/proxy` install resolves.
3. **R3 — the port is a no-op: 33 requests, 0 differences** between old `doorFor`+`DOORS` and a prototype
   matcher over the new file, on (policy, max, window, burst, key-partition, browser_only). Bucket strings
   deliberately not compared (`LOGIN_SEND`'s `actor`-with-an-email vs `email`).
4. **R4 — `repeat` weighting**: 20 same-URL hits spend 1.95 of a budget of 20; 20 distinct spend 20.00; the
   21st distinct is refused. Correction: the URL memory must live inside the backend's hit list so the
   window prunes it.
5. **R5 — every one of 13 env sites maps to a file**, 0 unmapped. `anon_mint` 0 / 10 / 2000.
6. **R6 — `always: [ip_flood]` is a NEW limit**: `DOORS.GLOBAL` is never returned by `doorFor`. Shipped `always: []`.
7. **R7 — nine malformed inputs, nine refusals**, each naming the offending path; a missing file is ENOENT.
8. **R9 — the audit does NOT see a stale `RATE_LIMITER__*`**, and removing `consumedByPrefix` does not change
   that: `utils/src/env.ts:21`'s `OURS = /^[A-Z][A-Z0-9]*__[A-Z0-9_]+$/` has no underscore in the module half.
9. **R10 — nothing calls `Limiter.acquire`** outside the engine and one test; the lease half is recommended deleted.
10. **§1.3 — nothing imports `services/app/lib/rate-limiter/*`.** "Shrinks to what the app still needs"
    measures to nothing; both files are deleted.
11. **`_KEY` overrides — no production code reads one** (two test lines and two doc lines only).

## Contradictions and gaps (full list in PLAN §5)

- **C1** `m2-anon-mint-door.test.ts` cannot "keep passing untouched": five of its lines set the removed knob.
  Env lines change; every assertion stays.
- **C2** The brief is silent on `EVENTS_STREAMS` / `Lease` / `LimiterBackend.acquire|release` — a whole half
  of the contract with no home in a policy file. Recommended: delete (R10).
- **C3** The brief's YAML sample is a sketch: a true no-op needs 10 policies and 16 route rows, not 6 and 5.
- **C4** `loadPolicyFile` is in the PROXY package, not utils, so `yaml` stays out of the app's closure.
- **C5/C6/C7** The brief's default-path measurement, its `yaml`-externals claim, and the coordinator's
  audit assumption are each measured wrong for OSS (R1, R2, R9).
- **C8** `method !== GET && != HEAD` becomes `[POST,PUT,PATCH,DELETE,OPTIONS]`; an exotic verb on
  `/api/artifacts` is no longer metered. Judged acceptable.
- **C11 (from the decision change)** The three relaxed ceilings (500 / 1000 / 2000) collapse into ONE dev
  file at 2000. `npm run dev` and the CI image boot get 2000 where they had 1000 and 500. The alternative is
  a fourth file; I did not invent a knob.
- **C12** A THIRD shipped file (`selfhost_rate_limits.yml`, `anon_mint: 10`) was needed: `docker-compose.yml`
  and `vitest.config.ts` both want 10, and neither production's 0 nor dev's 2000 is right for them.
- **C10** CLAUDE.md forbids committing `.agent/`; the brief demands it. Committed with `git add -f`.
  **The orchestrator should `git rm --cached .agent/PLAN.md .agent/REPORT.md` before merging to `main`.**

## Milestones (from the register, riskiest first)

- **M1 — the cutover.** R1, R9, R3, R5, R2, R7, R8, R6, R10, R11. Engine + loader + three files + every
  deletion; ends with the suite green, the bundle run from a copy of the image layout, `npm run dev` +
  `test:gates`, the lean compose walk, and a stale knob printing `[env] … nothing reads it`.
- **M2 — `repeat` and the `card` route.** R4, R12. The card route does NOT ship in M1: without `repeat` it
  would *raise* the card export ceiling from 30/min to 600/min.
- **M3 — docs and the env surface.** `.env.example` drags `ENV_EXAMPLE_BASE64` and `setup-plan.test.mjs`.
- **M4 — prod (other repo).** Baked file + `PROXY__RATE_LIMIT_CONFIG_FILE`, `yaml` in prod's `--external`,
  the box's `.env.production` cleanup (`RATE_LIMITER__ANON_MINT_MAX`, `RATE_LIMITER__EXPORT_MAX` removed or
  the stack check's audit leg fails), the stack-check card/export leg, and prod's bundle at a third depth.

===CONCISE===

Planned only; nothing implemented. Commit `faaf3ff` seeds contracts
(`services/contracts/src/rate-limits.ts`), three policy files
(`services/proxy/{default,selfhost,dev}_rate_limits.yml`), two skeletons that throw, and **42 tests, all
RED** (`3 failed (3)` files, `42 failed (42)`). Full suite `3196 tests: 42 failed | 3153 passed | 1 skipped`
— the 42 are exactly the seeded ones; `npm run validate` clean.

Three brief claims measured **wrong**, all mitigated in the plan:
1. `new URL('../default_rate_limits.yml', import.meta.url)` is ENOENT in **both** OSS images (the bundle sits
   at `services/proxy/proxy.mjs` and at `/app/server.mjs`, not where the source sits). Fixed by an upward
   walk for `services/proxy/default_rate_limits.yml` — the only rule that hits in all three layouts, and it
   needs no Dockerfile change.
2. `yaml` bundles fine under OSS's bundler (prod's "Dynamic require" finding does not transfer).
3. A stale `RATE_LIMITER__ANON_MINT_MAX` is **not** seen by the proxy's unknown-name audit and never has
   been — `utils/src/env.ts`'s `OURS` regex forbids an underscore in the module half. Needs widening.

Also: the port IS a no-op (33 requests, 0 differences vs `doorFor`); `always: [ip_flood]` would be a NEW
limit (`DOORS.GLOBAL` is dead) so the files ship `always: []`; `EVENTS_STREAMS` and the whole lease half of
the contract have no home in a policy file and are recommended deleted; a THIRD file (`selfhost`, mint 10)
was required by `docker-compose.yml` and `vitest.config.ts`; the card route moves to M2 because without
`repeat` it loosens the export ceiling. `.agent/*` is committed with `-f` against CLAUDE.md — drop it before
merging to `main`.
