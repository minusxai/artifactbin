# Working on artifactbin

`CLAUDE.md` imports this file. Setup: [CONTRIBUTING.md](CONTRIBUTING.md).

## CHECK TIERS — READ THIS BEFORE RUNNING ANY COMMAND

**FAST tier (seconds, catches almost every error) — after every change:** `npm run validate`,
`npm test -- --files <paths>`, the running dev app, `npm run afbin`.

**SLOW tier (minutes, 15–50× longer) — EXACTLY ONCE, at the very end, immediately before merge.
NEVER after an individual edit, "just to check" or mid-task:** gate containers, pushing for PR CI, bare `npm test`.

- **Finish the ENTIRE change on FAST checks, then run the SLOW tier ONE time.** Never a gate or a push per edit.
- **Gates belong to PR CI** (7 gate shards, the build, every test shard). Run a local gate container
  only if CI's gate shard failed or you changed the reader/hydration.
- **Pre-merge is one sequence, run once:** FAST tier clean → commit and push ONCE → PR CI green →
  the exact user scenario verified end to end on the built artifact → merge.
- Pushing, polling CI or gating per edit: **STOP. You are doing it wrong.**

## CI speed contract

Measure the complete required-check chain from the workflow attempt's `run_started_at` through
its final rollup, including runner setup, dependency waits and artifact uploads. Aim below **3 minutes**;
normal maximum is below **4 minutes**. CI fails above **8 minutes** on PRs and main. Individual job times,
parallel-job sums and full workflow durations are different metrics. Per-job durations above four
minutes produce diagnostics, not timing failures; the complete chain owns the hard eight-minute limit. Optional cache warming and
post-check downstream release notifications are outside this required-check chain; report their tails separately.
Investigate the critical path and repeated work; never raise the budget, skip required coverage, subtract
queues or rerun unchanged code to hide a slow run. Report cold and warm timings separately.

## Working rules

- Design modules first (Ousterhout): state affected boundaries and contracts; prefer a cohesive module
  hiding complexity behind a narrow interface. Routes translate results to HTTP.
- TDD for features and refactors: contracts, then behavioral tests, observe the failure, implement.
  Refactors: existing tests pass, prove the assertion detects broken behavior, restore it (Blue → Red → Blue).
  Report what actually ran; never claim red/green or end-to-end evidence you did not observe.
- Probe risky assumptions; record evidence and unknowns in the plan. Order milestones by
  plan-changing risk; finish with runnable checks.
- Verify user-facing changes on the task's running app (`npm run dev`, port `APP__PORT` in `.env`;
  a worktree has its own). Changed `services/cli` or the skill: `npm run afbin -- <args>` runs the
  branch's CLI against that server, state in `~/.artifactbin-dev/<port>` (home and released `afbin`
  untouched); `npm run eval -- --tasks <name>` shows an agent using them. Both take `APP__PORT=<n>`.
  Never test or iterate on production — it is confirmed after a deploy, not explored.
- **50 test files TOTAL across Vitest + CLI.** Above 50, `npm test` runs neither suite and exits 2:
  **DEFERRED TO CI, NOT PASSED**. No affected tests also means unverified (exit 2); discovery errors
  fail visibly. Never count/preview tests, raise the cap, use `--all`, bypass the wrapper, or split
  a deferred suite into local batches.
- **Deferral mid-task means you ran the wrong command**: drop back to `--files` and keep working. At
  the end of a complete, FAST-clean change it is the normal handoff: commit, push ONCE, open/update a
  PR with an empty body and inspect CI (a branch push alone starts none). Report deferral accurately;
  require selected checks before merging. Full suites, Docker/Chromium integration, the gate set and
  production builds are CI-only. On a red PR: fetch every failed job's log in ONE command, fix all
  failures together (independent ones in parallel agents), never retry unchanged code.
- **Reuse evidence** in the same worktree: `npm run validate -- --reuse`, `npm test -- --reuse` (same
  arguments). Receipts last an hour and need matching sources, command, environment, runtime, lock and
  generated inputs; failed/deferred/empty runs never count. Label reuse as prior evidence, not a fresh
  run or CI. Never copy receipts; omit `--reuse` after manual changes to ignored dependencies or
  external state. See [docs/agent-workflows.md](docs/agent-workflows.md).
- **Bound investigation:** scoped `rg -l`/`rg -n`, output limits, targeted sections; skip fixtures,
  transcripts, generated assets and dependencies unless relevant; batch reads, never repeat a search.
- Changing pinned docs/copy/errors: find their tests and gates (`buildQuickSheet`, `agentDiscovery`,
  `renderDoc`, exact text) and update them together. PR bodies stay empty, with no descriptive PR
  comments unless requested. Reuse only the task's own current dev server.
- After a merge: local main to latest origin/main, `git worktree prune`, remove finished worktrees.
- Top-level imports, except intentional lazy browser chunks and engine-selecting imports; document a
  new exception at the boundary and verify the bundle.
- Read environment variables through the owning service's audited config module (CLI scripts and
  eval harnesses have their own). `MODULE__NAME` settings; spread typed objects, never re-enumerate keys.
- Product code is independent of downstream deployments. Shared types/constants: `services/contracts`;
  shared transport and assembly: `services/utils`. The app never imports the proxy. Local and HTTP
  service implementations keep the same contracts.
- Bearer secrets stay out of URLs, documents, logs and storage; test tokens are not real credentials.
  Use `mxmx_test_*` accounts for disposable browser flows; read local OTPs with `npm run dev:otp`,
  never a public app endpoint.
- UI tests use accessible names; interactive controls need accessible labels. App tooltips use
  `solid/components/Tooltip.tsx`, not native `title` tooltips.
- Tests exercise real handlers on isolated state, resetting database and limiter state between cases.
  Merge gates use deterministic third-party fixtures; live-provider checks are separate.
- Never hand-edit generated routes, schemas or CSS candidate lists: run their generators, review the diff.

## Commands

From the repo root; keep this list current.

- `npm ci` — install pinned dependencies. `npm run setup` — create or repair local settings.
- `npm run dev` — full local composition, default http://localhost:3030; `dev:app` without the proxy.
- `npm run afbin -- <args>` — the branch's CLI against this checkout's dev server.
- `npm run eval -- --tasks <name>` — the agent eval against that server (`--deployment`, `--help`).
  `evals/` is the private, gitignored `minusxai/artifactbin-evals` repo (README is the guide): copy
  it from `~/projects/artifactbin-evals/evals`, never symlink.
- `npm run dev:otp -- <email>` — a local login code from the protected outbox.
- `npm run validate` — FAST: name guard, incremental TypeScript (`tsgo` where installed, else
  tsc) with unused declarations; utils/contracts add `noUncheckedIndexedAccess`.
- `npm test` — affected api/node/ui/islands + CLI tests, ≤50 files; exit 2 means PR CI, never widen.
  `-- --files <paths>` is the FAST inner loop; bare and `-- <ref>` (branch changes) are SLOW, pre-merge
  only; `-- --reuse` reuses evidence. Config/package edits may defer everything (expected).
- `node scripts/gate-container.mjs [--cpus 4] [--memory 8g] <gate ...>` — **SLOW, PRE-MERGE
  ONLY, NEVER AFTER AN EDIT**: named browser gates in a Linux container, built (CI's gate build, reused
  until a build input changes) and served as CI does.
  `node scripts/gate-container.mjs kit-and-fonts` verifies the compiled reader handover (reader/islands changes).
- CI-only: `npm run test:all`, `test:{api,node,ui,islands,integration,gates}`, `build`.
  Never use them to bypass deferral.
- `npm run build:islands -w services/app` — the shared reader islands and manifest.
- Generated inputs: `npm run generate:routes`, `generate-story-ui-classes`, `render:schema`,
  `generate:og`, `generate:design-systems` (the runtime registry and the
  agent references from `design-systems/specs`; `-- pages` the specimen pages into `tmp/`).
- `npm run release:cli` — bump the CLI release; see Change checks.

## Change checks

- CLI releases: `npm run release:cli` in the CLI's PR, or the `Release afbin` dispatch (straight to
  main). `checks` refuses a CLI PR without a bump; a version-only diff packs npm and verifies native consumers; a tree PR
  CI passed is not re-tested on merge. [Steps](services/cli/README.md). Teaching is generated before
  install/check/dev/build; never commit `services/cli/src/generated/teaching.json`. Main CI publishes
  the tested assets; deploys advance their source pin and verify the release before serving its installer.
- Schema changes update `services/app/lib/platform/schema.ts`, schema ownership tests, and SQL via
  `npm run render:schema`. Settings changes update the owning config module, `.env.example`, and the
  setup planner's snapshot via `npm run generate:env-snapshot` (its test fails on drift).
- PGLite owns one serialized connection per process: never enqueue an out-of-transaction query inside
  a transaction callback. Send notifications/telemetry after commit; preserve atomic edits.
- Preserve access checks on reads, writes, exports, live streams and dataset mutations; public/unlisted
  link access is neither ownership nor dataset write access.
- Rendering, editing and author scripts have separate trust boundaries. Read
  [services/app/lib/story-ui/AGENTS.md](services/app/lib/story-ui/AGENTS.md) before changing markup.
- After a lockfile merge, regenerate if needed and run `npm ci --dry-run` (a populated install hides
  a broken lockfile). Native packages and browser assets also need build/image verification.

## Delegated work

The orchestrator seeds contracts, core tests and a bounded brief; the implementer completes it without
delegating, in its own worktree, data directory and port block (never two in one checkout).
**Independent deliverables are separate briefs, one implementer each, in parallel worktrees; one brief
only when deliverables share files. The orchestrator merges.** Browser gates run in containers
(`scripts/gate-container.mjs`), up to engine CPUs ÷ container CPUs at once (`GATES__CONTAINER_SLOTS`
overrides), never on the host. **Gates are SLOW-tier: an implementer runs them ONCE at the end of the
brief, NEVER per edit. Every brief must say so verbatim.** Keep PRs scoped per repository.
Handoff: [docs/agent-workflows.md](docs/agent-workflows.md).
