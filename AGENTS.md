# Working on artifactbin

`CLAUDE.md` imports this file. [Setup](CONTRIBUTING.md).

## Check tiers — read before running commands

**FAST — after every change:** `npm run validate`,
`npm test -- --files <paths>`, the running dev app.

**SLOW — once at completion before merge, never mid-task/per edit:** gate containers, PR CI push, bare `npm test`.

- **Finish on FAST, then SLOW once.** Never push, poll CI or gate per edit.
- **Full gates belong to main PR and post-merge CI** (7 gate shards, the build, every test shard). Local gates only for failed CI gate shards or reader/hydration changes.
- **Pre-merge is one sequence, run once:** FAST tier clean → commit and push ONCE → PR CI green →
  the exact user scenario verified end to end on the built artifact → merge.
- **PRs into `main`: ONLY use squash and merge** (`gh pr merge --squash`). NEVER land all
  branch commits via the PR methods "Create a merge commit" (`gh pr merge --merge`) or
  "Rebase and merge" (`gh pr merge --rebase`). Each PR lands as one squashed commit on `main`.
  Rebasing a working branch, including onto `main`, is allowed; this restriction applies only
  to the final PR merge method.

## CI speed contract

For PRs targeting **`main`**, the required check is `pr fast` (`.github/workflows/pr-fast.yml`):
validate, workflow lint, JavaScript syntax and the fast module list on three runners. Aim for
**40 seconds**; the limit is **60 seconds**, from `run_started_at` to the last job, and each job's final
step fails the PR past it (`scripts/lib/ci-elapsed.mjs`, pinned by `scripts/__tests__/ci-budget.test.mjs`).
Never raise it. On a PR, `ci.yml` (affected modules) and `page speed` are informational.

For the **full post-merge chain** (and `ci.yml` on a PR), measure from `run_started_at` through
final rollup, including runner setup, dependency waits and uploads. Aim below **3 minutes**; normal
maximum below **4 minutes**. The full chain fails above **8 minutes**. Job times, parallel sums and
workflow durations differ; per-job durations above four minutes produce diagnostics rather than
replacing the complete-chain limit. Report optional cache warming and downstream release notification
tails separately; they are outside that chain.
Investigate the critical path and repetition; never raise budgets, skip coverage, subtract queues
or rerun unchanged code to hide slowness. Report cold and warm timings separately.

## Working rules

- Design modules first (Ousterhout): cohesive boundaries/contracts, narrow interfaces; routes translate to HTTP.
- Layers: entry points `server.ts`, `scripts`, `services/app/{app,server,scripts}`; UI `services/app/{solid,web}`;
  libraries `services/app/lib/*`; packages the other `services/*`, importing only `contracts`, `utils` and themselves.
  `npm run validate` (`scripts/ci/module-graph.mjs`) fails a cycle through an entry point or the UI, a package
  import outside that floor, a new edge in the lib cycle (`module-graph.allowed-cycles.json`) and an unlisted
  deep import (`DEEP_MODULES`).
- TDD for features and refactors: contracts, then behavioral tests, observe the failure, implement.
  Refactors: existing tests pass, prove the assertion detects broken behavior, restore it (Blue → Red → Blue).
  Report only observed runs and red/green/end-to-end evidence.
- Probe assumptions; record evidence/unknowns. Order milestones by risk; end with runnable checks.
- Verify user-facing changes on the task's running app (`npm run dev`, port `APP__PORT` in `.env`;
  a worktree has its own). Changed the skill: `npm run eval` shows an agent using it; it takes `APP__PORT=<n>`.
  Never iterate/test on production; confirm after deploy.
- **Local evals use the real product contract.** Supply target origin and exact candidate skill
  assets independently. Local/deployed briefs and scorers are identical: no local-only prompts, auth
  bypass, production deployment or published/latest fallback. Test installed/fresh-install paths
  against the candidate; HTTP discovery/guides/auth/API use the target. Isolate harness homes,
  credentials/data. Record server/source revision, candidate/skill hashes and harness/model/settings;
  invalidate stale assets on relevant inputs.
  Package and skill edits reach the next run.
  Reproductions/timings (including Pi) reuse this eval harness, target/candidate, isolation,
  auth, traces and metrics; add scenarios/capabilities, never separate runners. URL probes use
  verbatim user requests. Changed harness semantics require a matched new baseline.
  Harness delivers local OTP; agent follows normal auth.
  Enforce caps outside model context; no evaluator/scorer/answer hints via prompts, hooks or config.
  Preserve native replies and private instruction evidence.
  Compare baseline/candidate with identical scenarios/settings; retain failures and missing metrics.
- **50 files TOTAL.** Above 50: nothing runs; exit 2 means **DEFERRED, NOT PASSED**.
  No affected tests: unverified (exit 2). Discovery errors fail. No counting/previewing, cap increases,
  `--all`, wrapper bypasses or deferred-suite batching.
- **Mid-task deferral**: return to `--files`. After FAST: commit, push ONCE,
  open/update an empty-body PR (no descriptive comments unless requested), inspect CI. Report deferral;
  require selected checks before merge. Full suites, Docker/Chromium integration, gates/builds are CI-only.
  On a red PR: fetch every failed job's log in ONE command, fix all
  failures together (independent ones in parallel agents), never retry unchanged code.
- **Reuse evidence** in the same worktree: `npm run validate -- --reuse`, `npm test -- --reuse` (same
  arguments). One-hour receipts need matching sources, command, environment, runtime, lock and generated inputs;
  failed/deferred/empty runs never count. Label prior evidence, never fresh/CI; omit reuse after manual
  external-state changes; never copy receipts. See [docs/agent-workflows.md](docs/agent-workflows.md).
- **Bound investigation:** scoped `rg -l`/`rg -n`, bounded output/sections; skip irrelevant fixtures,
  transcripts/assets/dependencies; batch reads, never repeat searches.
- Author skill: test contracts, never prose. Pinned docs/copy/errors: find their tests and gates
  (`buildQuickSheet`, `agentDiscovery`, `renderDoc`, exact text) and update them. Guide edits run
  `services/app/lib/__tests__/skill-tree.test.ts`: rendered guides stay within 8,192 bytes.
  Reuse only the task's own dev server.
- After a merge: local main to latest origin/main, `git worktree prune`, remove finished worktrees.
- Top-level imports, except intentional lazy browser chunks and engine-selecting imports; document a
  new exception at the boundary and verify the bundle.
- Read env vars through owning service audited config (scripts/eval harnesses own theirs). `MODULE__NAME` settings; spread typed objects, never re-enumerate keys.
- Product code ignores downstream deployments. Shared types/constants: `services/contracts`;
  shared transport and assembly: `services/utils`. The app never imports the proxy. Local and HTTP
  service implementations keep the same contracts.
- Keep bearer secrets out of URLs/docs/logs/storage; test tokens are not credentials.
  Use `mxmx_test_*` accounts for disposable browser flows; read local OTPs with `npm run dev:otp`,
  never a public app endpoint.
- **App chrome composes `services/app/solid/ui`** (md forms, sm chrome; `rounded-chip|control|panel|dialog`,
  `text-micro|2xs`, `h-control*`); `/dev/ui` shows all. `scripts/ci/check-ui-primitives.mjs` refuses
  hand-rolled controls, overlays and one-off styles: add needs to ui. UI tests use accessible names;
  tooltips use `ui/Tooltip`, not `title`.
- Tests: real handlers, isolated state, reset database/limiter. Gates: deterministic third-party
  fixtures; separate live-provider checks.
- Generate routes/schemas/CSS lists; never hand-edit; review diffs.

## Commands

From repo root.

- `npm ci` — install pinned dependencies. `npm run setup` — create or repair local settings.
- `npm run dev` — full local composition, default http://localhost:3030; `dev:app` the app alone, without login/OAuth.
- `npm run eval -- --tasks <name>` — the agent eval against that server (`--deployment`, `--help`).
  `evals/` is the private, gitignored `minusxai/artifactbin-evals` repo (its README is the guide): copy
  it from `~/projects/artifactbin-evals/evals`, never symlink; a copy lacking `evals/README.md` is stale.
- `npm run dev:otp -- <email>` — a local login code from the protected outbox.
- `npm run validate` — FAST: name guard, incremental TypeScript (TypeScript 7's native compiler where its platform package installed, `tsc` 5 elsewhere; `scripts/lib/type-check.mjs`) with unused declarations, the module-graph check (`scripts/ci/module-graph.mjs`);
  utils/contracts add `noUncheckedIndexedAccess`.
- `npm test` — affected api/node/ui/islands tests, ≤50 files; exit 2 means PR CI, never widen.
  `-- --files <paths>` is the FAST inner loop; bare and `-- <ref>` (branch changes) are SLOW, pre-merge
  only; `-- --reuse` reuses evidence. Config/package edits may defer everything (expected).
- `node scripts/gate-container.mjs [--cpus 4] [--memory 8g] <gate ...>` — **SLOW, PRE-MERGE
  ONLY, NEVER AFTER AN EDIT**: named browser gates in a Linux container, built (CI's gate build, reused
  until a build input changes) and served as CI does.
  `node scripts/gate-container.mjs kit-and-fonts` verifies the compiled reader handover (reader/islands changes).
- CI-only, never a deferral bypass: `npm run test:all`, `test:{api,node,ui,islands,integration,gates}`, `build`.
- `npm run build:islands -w services/app` — the shared reader islands and manifest.
- Generated inputs: `npm run generate:routes`, `generate-story-ui-classes`, `render:schema`,
  `generate:og`, `generate:design-systems` (runtime registry and agent
  references from `design-systems/specs`; `-- pages`: specimen pages into `tmp/`).

## Change checks

- Kit renderer changes, including inline wrapper styles and any `EXTRA_CLASS_SOURCES` input
  (such as `compiled-page/compiler.ts`): run `npm run generate-story-ui-classes`
  and review the generated diff before final CI. FAST regression checks are
  `services/app/lib/story-ui/__tests__/recipe-classes.test.ts` and
  `services/app/lib/publish/__tests__/reader-sheet.test.ts`; types do not catch drift.
- A tree PR CI passed is not re-tested on merge.
- Schema changes update `services/app/lib/platform/schema.ts`, schema ownership tests, and SQL via
  `npm run render:schema`. Settings changes update the owning config module, `.env.example`, and the
  setup planner's snapshot via `npm run generate:env-snapshot` (its test fails on drift).
- PGLite owns one serialized connection per process: never enqueue an out-of-transaction query inside
  a transaction callback. Send notifications/telemetry after commit; preserve atomic edits.
- Preserve access checks on reads, writes, exports, live streams and dataset mutations; public/unlisted
  link access is neither ownership nor dataset write access.
- Rendering, editing and author scripts have separate trust boundaries. Read
  [services/app/lib/story-ui/AGENTS.md](services/app/lib/story-ui/AGENTS.md) before markup changes.
- After a lockfile merge, regenerate if needed and run `npm ci --dry-run` (a populated install hides
  a broken lockfile). Native packages/browser assets need build/image verification.

## Delegated work

The orchestrator seeds contracts, core tests and a bounded brief; each implementer uses its own
worktree, data directory and port block, never delegates or shares a checkout.
**Independent deliverables get separate briefs/implementers in parallel worktrees; shared files get one brief. The orchestrator merges.** Browser gates run in containers
(`scripts/gate-container.mjs`), up to engine CPUs ÷ container CPUs at once (`GATES__CONTAINER_SLOTS`
overrides), never on the host. **Gates are SLOW-tier: an implementer runs them ONCE at the end of the
brief, NEVER per edit. Every brief must say so verbatim.** Separate PRs per repository.
Handoff: [docs/agent-workflows.md](docs/agent-workflows.md).
