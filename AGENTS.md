# Working on artifactbin

`CLAUDE.md` imports this file. [Setup](CONTRIBUTING.md).

## Check tiers — read before running commands

**FAST — after every change:** `npm run validate`,
`npm test -- --files <paths>`, the running dev app, `npm run afbin`.

**SLOW — EXACTLY ONCE, at the end before merge. NEVER per edit or mid-task:** gate containers, pushing for PR CI, bare `npm test`.

- **Finish the entire change on FAST checks, then SLOW once.** No gate or push per edit.
- **Gates belong to PR CI** (7 gate shards, the build, every test shard). Local gates only for failed CI gate shards or reader/hydration changes.
- **Pre-merge is one sequence, run once:** FAST tier clean → commit and push ONCE → PR CI green →
  the exact user scenario verified end to end on the built artifact → merge.
- Never push, poll CI or gate per edit.

## CI speed contract

Measure the required-check chain from `run_started_at` through final rollup, including runner setup,
dependency waits and uploads. Aim below **3 minutes**; normal maximum below **4 minutes**. CI fails above **8 minutes** on PRs and main. Job times,
parallel sums and workflow durations differ. Per-job durations above four
minutes produce diagnostics, not timing failures; the complete chain owns the hard eight-minute limit. Report optional cache warming and downstream release
notification tails separately; they are outside the chain.
Investigate the critical path and repetition; never raise budgets, skip coverage, subtract queues
or rerun unchanged code to hide slowness. Report cold and warm timings separately.

## Working rules

- Design modules first (Ousterhout): state boundaries/contracts; hide complexity in cohesive modules
  with narrow interfaces. Routes translate results to HTTP.
- Layers: entry points `server.ts`, `scripts`, `services/cli`, `services/app/{app,server,scripts}`; UI `services/app/{solid,web}`;
  libraries `services/app/lib/*`; packages the other `services/*`, importing only `contracts`, `utils` and themselves.
  `npm run validate` (`scripts/ci/module-graph.mjs`) fails a cycle through an entry point or the UI, a package
  import outside that floor, a new edge in the lib cycle (`module-graph.allowed-cycles.json`) and an unlisted
  deep import (`DEEP_MODULES`); `services/cli/src` imports app code only via `lib/cli-toolkit` entries.
- TDD for features and refactors: contracts, then behavioral tests, observe the failure, implement.
  Refactors: existing tests pass, prove the assertion detects broken behavior, restore it (Blue → Red → Blue).
  Report only observed runs and red/green/end-to-end evidence.
- Probe risky assumptions; record evidence/unknowns. Order milestones by plan-changing risk; finish
  with runnable checks.
- Verify user-facing changes on the task's running app (`npm run dev`, port `APP__PORT` in `.env`;
  a worktree has its own). Changed `services/cli` or the skill: `npm run afbin -- <args>` runs the
  branch's CLI against that server, state in `~/.artifactbin-dev/<port>` (home and released `afbin`
  untouched); `npm run eval -- --tasks <name>` shows an agent using them. Both take `APP__PORT=<n>`.
  Never iterate/test on production; confirm after deploy.
- **Local evals use the real product contract.** Supply target origin and exact candidate CLI/skill
  assets independently. Local/deployed briefs and scorers are identical: no local-only prompts, auth
  bypass, production deployment or published/latest fallback. Test installed/fresh-install paths
  against the candidate; HTTP discovery/guides/auth/API use the target. Isolate harness homes,
  credentials/data. Record server/source revision, candidate/skill hashes and harness/model/settings;
  invalidate stale assets on relevant inputs.
  CLI/shared-package/skill edits reach the next run without release.
  Exception for this workflow: building/packing the complete candidate CLI and its required runtime
  assets locally is eval preparation, not a CI check. Use the normal package assembly, once per
  relevant source snapshot with an input-hash receipt; never a reduced-capability substitute or
  published-package fallback. This exception does not permit local full suites or merge gates.
  Harness delivers local OTP; agent follows normal auth.
  Compare baseline/candidate with identical scenarios/settings; retain failures and missing metrics.
- **50 test files TOTAL across Vitest + CLI.** Above 50, neither suite runs; exit 2:
  **DEFERRED TO CI, NOT PASSED**. No affected tests means unverified (exit 2); discovery errors fail visibly. Never count/preview, raise the cap, use `--all`, bypass the wrapper or batch a deferred suite.
- **Mid-task deferral is the wrong command**: return to `--files`. At FAST-clean completion:
  commit, push ONCE, open/update an empty-body PR and inspect CI (branch pushes start none). Report
  deferral accurately; require selected checks before merge. Full suites, Docker/Chromium integration, gates and builds are CI-only. On a red PR: fetch every failed job's log in ONE command, fix all
  failures together (independent ones in parallel agents), never retry unchanged code.
- **Reuse evidence** in the same worktree: `npm run validate -- --reuse`, `npm test -- --reuse` (same
  arguments). One-hour receipts require matching sources, command, environment, runtime, lock and
  generated inputs; failed/deferred/empty runs never count. Label prior evidence, never fresh/CI.
  Never copy receipts; omit reuse after manual ignored-dependency/external-state changes.
  See [docs/agent-workflows.md](docs/agent-workflows.md).
- **Bound investigation:** scoped `rg -l`/`rg -n`, bounded output/sections; skip irrelevant fixtures,
  transcripts/assets/dependencies; batch reads, never repeat searches.
- Changing pinned docs/copy/errors: find their tests and gates (`buildQuickSheet`, `agentDiscovery`,
  `renderDoc`, exact text) and update them together. Skill guide edits also run
  `services/app/lib/__tests__/skill-tree.test.ts`: each rendered guide must stay within 8,192 bytes.
  PR bodies stay empty, with no descriptive PR
  comments unless requested. Reuse only the task's own current dev server.
- After a merge: local main to latest origin/main, `git worktree prune`, remove finished worktrees.
- Top-level imports, except intentional lazy browser chunks and engine-selecting imports; document a
  new exception at the boundary and verify the bundle.
- Read env vars through owning service audited config (CLI scripts/eval harnesses own theirs). `MODULE__NAME` settings; spread typed objects, never re-enumerate keys.
- Product code ignores downstream deployments. Shared types/constants: `services/contracts`;
  shared transport and assembly: `services/utils`. The app never imports the proxy. Local and HTTP
  service implementations keep the same contracts.
- Keep bearer secrets out of URLs/docs/logs/storage; test tokens are not credentials.
  Use `mxmx_test_*` accounts for disposable browser flows; read local OTPs with `npm run dev:otp`,
  never a public app endpoint.
- UI tests use accessible names; label controls. Tooltips use
  `solid/components/Tooltip.tsx`, not native `title` tooltips.
- Tests use real handlers on isolated state; reset database/limiter between cases.
  Merge gates use deterministic third-party fixtures; live-provider checks are separate.
- Generate routes/schemas/CSS candidate lists; never hand-edit. Review diffs.

## Commands

From repo root. Keep current.

- `npm ci` — install pinned dependencies. `npm run setup` — create or repair local settings.
- `npm run dev` — full local composition, default http://localhost:3030; `dev:app` the app alone, without login/OAuth.
- `npm run afbin -- <args>` — the branch's CLI against this checkout's dev server.
- `npm run eval -- --tasks <name>` — the agent eval against that server (`--deployment`, `--help`).
  `evals/` is the private, gitignored `minusxai/artifactbin-evals` repo (its README is the guide): copy
  it from `~/projects/artifactbin-evals/evals`, never symlink; a copy lacking `evals/README.md` is stale, so recopy.
- `npm run dev:otp -- <email>` — a local login code from the protected outbox.
- `npm run validate` — FAST: name guard, incremental TypeScript (`tsgo` where installed, else
  tsc) with unused declarations, the module-graph check (`scripts/ci/module-graph.mjs`);
  utils/contracts add `noUncheckedIndexedAccess`.
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

- Kit renderer changes, including inline wrapper styles and any `EXTRA_CLASS_SOURCES` input
  (such as `compiled-page/compiler.ts`): run `npm run generate-story-ui-classes`
  and review the generated diff before final CI. FAST regression checks are
  `services/app/lib/story-ui/__tests__/recipe-classes.test.ts` and
  `services/app/lib/publish/__tests__/reader-sheet.test.ts`; types do not catch drift.
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
  [services/app/lib/story-ui/AGENTS.md](services/app/lib/story-ui/AGENTS.md) before markup changes.
- After a lockfile merge, regenerate if needed and run `npm ci --dry-run` (a populated install hides
  a broken lockfile). Native packages/browser assets need build/image verification.

## Delegated work

The orchestrator seeds contracts, core tests and a bounded brief; each implementer uses its own
worktree, data directory and port block, never delegates or shares a checkout.
**Independent deliverables get separate briefs/implementers in parallel worktrees; shared files get one brief. The orchestrator merges.** Browser gates run in containers
(`scripts/gate-container.mjs`), up to engine CPUs ÷ container CPUs at once (`GATES__CONTAINER_SLOTS`
overrides), never on the host. **Gates are SLOW-tier: an implementer runs them ONCE at the end of the
brief, NEVER per edit. Every brief must say so verbatim.** Keep PRs scoped per repository.
Handoff: [docs/agent-workflows.md](docs/agent-workflows.md).
